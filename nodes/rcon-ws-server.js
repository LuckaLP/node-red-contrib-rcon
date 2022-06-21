module.exports = function (RED) {
  "use strict";

  var WebSocket = require('ws');

  // ====== Connection config node ===== \\
  function WSRCon(n) {
    RED.nodes.createNode(this, n);

    // Configuration options passed by Node Red
    this.name = n.name;
    this.host = n.host;
    this.port = n.port;
    this.clientid = n.clientid;
    this.keepalive = n.keepalive || 5;

    // Config node state
    this.connected = false;
    this.connecting = false;
    this.lastHeartbeat = 0;
    this.closing = false;
    this.packetID = 0;

    if (this.credentials) {
      this.password = this.credentials.password;
    }

    // Define functions called by WS CMD nodes
    var node = this;
    this.users = {};
    this.qSubs = {};
    this.typeSubs = {};

    this.register = function (cmdNode) {
      node.users[cmdNode.id] = cmdNode;
      if (Object.keys(node.users).length === 1) {
        node.connect();
      }
    };

    this.deregister = function (cmdNode, done) {
      delete node.users[cmdNode.id];
      if (node.closing) {
        done();
      }
      if (Object.keys(node.users).length === 0) {
        if (node.client && node.connected) {
          node.client.close(1000);
          done();
        } else {
          done();
        }
      } else {
        done();
      }
    };

    this.sendUsersStatus = function (status) {
      for (var id in node.users) {
        if (node.users.hasOwnProperty(id)) {
          node.users[id].status(status);
        }
      }
    }

    this.sendUsersConnState = function (status) {
      for (var id in node.users) {
        if (node.users.hasOwnProperty(id)) {
          node.users[id].onConnState(status);
        }
      }
    }

    this.startMonitors = function () {
      node.stopMonitors();
      node.keepAliveTimer = setInterval(function () {
        let ts = Math.floor(Date.now() / 1000)
        if (node.connected && (ts - node.keepalive) > node.lastHeartbeat) {
          node.reconnect();
          node.log("heartbeat lost")
        }
      }, (node.keepalive || 30) * 1000)
      node.pingTimer = setInterval(function () {
        if (node.connected) {
          node.sendMsg("echo ping");
        }
      }, (node.keepalive || 30) / 2 * 1000)
    }
    this.stopMonitors = function () {
      if (node.pingTimer) clearInterval(node.pingTimer)
      if (node.keepAliveTimer) clearInterval(node.keepAliveTimer)
    }

    this.heartBeat = function () {
      // node.log('heartBeat');
      node.lastHeartbeat = Math.floor(Date.now() / 1000);
    }

    this.connect = function () {
      if (!node.connected && !node.connecting) {
        node.connecting = true;
        node.connected = false;
        try {
          node.sendUsersStatus({ fill: "yellow", shape: "ring", text: "connecting" });
          node.client = new WebSocket('ws://' + node.host + ':' + node.port + '/' + node.password);

          node.client.on('open', function () {
            node.connecting = false;
            node.connected = true;
            node.log("connected to " + (node.clientid ? node.clientid + "@" : "") + node.host + ":" + node.port);
            node.sendUsersStatus({ fill: "green", shape: "dot", text: "connected" });
            node.sendUsersConnState('connected');
            node.heartBeat();
            node.startMonitors();
          });

          node.client.on('message', function (data, flags) {
            node.heartBeat();
            try {
              var json = JSON.parse(data)
              if (json !== undefined) {
                if (json.Message !== undefined && json.Message.length > 0) {

                  if (json.Identifier) {
                    let id = `${json.Identifier}`

                    try {
                      if (id in node.qSubs) {
                        let nodeID = node.qSubs[id]
                        if (node.users[nodeID]) {
                          node.users[nodeID].onRConMSG(json)
                        }
                        delete node.qSubs[id]
                      }
                    } catch (e) {
                      delete node.qSubs[id]
                    }
                  }

                  if (json.Type !== undefined && json.Type.length > 0) {
                    let type = json.Type;
                    if (node.typeSubs[type]) {
                      for (let nodeID of node.typeSubs[type]) {
                        if (node.users[nodeID]) {
                          try {
                            node.users[nodeID].onRConMSG(json)
                          } catch (e) { }
                        }
                      }
                    }
                  }
                }
              } else {
                node.log('RconApp::Error: Invalid JSON received')
              }
            } catch (e) {
              if (e) node.log('RconApp::Error:', e)
            }
          })

          node.client.on('unexpected-response', function () {
            node.log('got unexpected-response')
          })

          node.client.on('error', function (e) {
            node.log("error:" + e);
            node.sendUsersStatus({ fill: "red", shape: "ring", text: "error:" + e });
            node.connected = false;
            node.connecting = false;
            node.reconnect();
          })

          node.client.on('close', function (code, msg) {
            // node.log('closed:', code, msg)
          })
        } catch (err) {
          node.log(err);
        }
      }
    };

    this.reconnect = function () {
      node.stopMonitors();
      node.log("reconnecting")
      setTimeout(function () {
        node.client.terminate();
        node.connected = false;
        node.connecting = false;
        node.connect();
      }, 5000)
    }

    this.sendMsg = function (payload, srcNode, notify) {
      if (node.connected) {
        node.packetID++;
        let packetID = node.packetID;
        if (notify) node.qSubs[packetID] = srcNode.id;

        var packet = JSON.stringify({
          Identifier: packetID,
          Message: payload,
          Name: node.clientid
        })
        node.client.send(packet);
      }
    };

    this.registerListen = function (type, userNode) {
      node.typeSubs[type] = node.typeSubs[type] || [];
      node.typeSubs[type].push(userNode.id)
    }

    this.on('close', function (done) {
      node.closing = true;
      node.stopMonitors();
      if (node.connected || node.connecting) {
        node.client.close(1000)
        node.connected = false
        node.connecting = false
        done();
      } else {
        done();
      }
    });

  }
  RED.nodes.registerType("rcon-ws-server", WSRCon, {
    credentials: {
      password: { type: "password" }
    }
  });
}