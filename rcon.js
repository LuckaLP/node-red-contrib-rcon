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
    this.keepalive = n.keepalive || 5000;

    // Config node state
    this.connected = false;
    this.connecting = false;
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
        return done();
      }
      if (Object.keys(node.users).length === 0) {
        if (node.client && node.connected) {
          node.client.close(1000);
          done();
        } else {
          return done();
        }
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

    this.connect = function () {
      if (!node.connected && !node.connecting) {
        node.connecting = true;
        try {
          node.sendUsersStatus({ fill: "yellow", shape: "ring", text: "connecting" });
          node.client = new WebSocket('ws://' + node.host + ':' + node.port + '/' + node.password);

          node.client.on('open', function () {
            node.connecting = false;
            node.connected = true;
            node.log("connected to " + (node.clientid ? node.clientid + "@" : "") + node.host + node.port);
            node.sendUsersStatus({ fill: "green", shape: "dot", text: "connected" });
            node.sendUsersConnState('connected');
          });

          node.client.on('message', function (data, flags) {
            try {
              var json = JSON.parse(data)
              if (json !== undefined) {
                if (json.Message !== undefined && json.Message.length > 0) {
                  console.log('RconApp::Received message:', json)

                  if (json.Identifier) {
                    let id = `${json.Identifier}`

                    try {
                      console.log("checking for id subs:", id, node.qSubs)
                      if (id in node.qSubs) {
                        let nodeID = node.qSubs[id]
                        if (node.users[nodeID]) {
                          node.users[nodeID].onRConMSG(json)
                        } else {
                          delete node.qSubs[id]
                        }
                      }
                    } catch (e) {
                      delete node.qSubs[id]
                    }
                  }

                  if (json.Type !== undefined && json.Type.length > 0) {
                    let type = json.Type;
                    try {
                      console.log("checking for type subs:", type, node.typeSubs)
                      if (node.typeSubs[type]) {
                        // let del = []
                        for (let nodeID of node.typeSubs[type]) {
                          if (node.users[nodeID]) {
                            node.users[nodeID].onRConMSG(json)
                          } else {
                            del.push(nodeID)
                          }
                        }
                        // for (let nodeID of del) {
                        //   node.typeSubs[type].splice(node.typeSubs[type].indexOf(nodeID), 1)
                        // }
                        // if (node.typeSubs[type].length < 1) {
                        //   delete node.typeSubs[type]
                        // }
                      }
                    } catch (e) {
                      // node.typeSubs[type].splice
                    }

                  }
                }
              } else console.log('RconApp::Error: Invalid JSON received')
            } catch (e) {
              if (e) console.log('RconApp::Error:', e)
            }
          })

          node.client.on('error', function (e) {
            node.log("error:", e);
            node.sendUsersStatus({ fill: "red", shape: "ring", text: "error:" + e });
            node.reconnect();
          })
        } catch (err) {
          console.log(err);
        }
      }
    };

    this.reconnect = function () {
      setTimeout(function () {
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
      this.closing = true;
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
      user: { type: "text" },
      password: { type: "password" }
    }
  });


  // ====== query node ===== \\
  function WSRconSend(n) {
    RED.nodes.createNode(this, n);

    // this.name = n.name;
    this.command = n.command || '';
    this.connection = n.connection;
    this.resendOnReconnect = n.resendOnReconnect || false;

    this.lastCommand = n.command;
    this.connNode = RED.nodes.getNode(this.connection);

    var node = this;

    if (this.connNode) {
      this.status({ fill: "red", shape: "ring", text: "disconnected" });

      // register on connection config node
      this.connNode.register(node)

      // input from another node
      this.on("input", function (msg) {
        if (!msg.payload) msg.payload = { payload: node.command };
        node.lastCommand = msg.payload;
        node._sendMsg(msg)
      });

      this._sendMsg = function (msg) {
        if (!this.connNode.connected) return;
        node.connNode.sendMsg(msg.payload)
      }

      this.onConnState = function (state) {
        switch (state) {
          case 'connected':
            if (node.resendOnReconnect && node.lastCommand) {
              node._sendMsg({ payload: node.lastCommand })
            }
            break;
        }
      }

      this.on('close', function (done) {
        node.connNode.deregister(node, done);
      })
    } else {
      this.error("connection node not defined");
    }
  }
  RED.nodes.registerType("rcon send", WSRconSend);

  // ====== query node ===== \\
  function WSRconQuery(n) {
    RED.nodes.createNode(this, n);

    // this.name = n.name;
    this.command = n.command || '';
    this.connection = n.connection;
    this.resendOnReconnect = n.resendOnReconnect || false;
    this.parseOutputAsJson = n.parseOutputAsJson || false;

    this.lastCommand = n.command;
    this.connNode = RED.nodes.getNode(this.connection);

    var node = this;

    if (this.connNode) {
      this.status({ fill: "red", shape: "ring", text: "disconnected" });

      // register on connection config node
      this.connNode.register(node)

      // input from another node
      this.on("input", function (msg) {
        if (!msg.payload) msg.payload = { payload: node.command };
        node.lastCommand = msg.payload;
        node._sendMsg(msg)
      });

      this._sendMsg = function (msg) {
        if (!this.connNode.connected) return;
        node.connNode.sendMsg(msg.payload, node, true)
      }

      this.onConnState = function (state) {
        switch (state) {
          case 'connected':
            if (node.resendOnReconnect && node.lastCommand) {
              node._sendMsg({ payload: node.lastCommand })
            }
            break;
        }
      }

      this.onRConMSG = function (msg) {
        if (node.parseOutputAsJson) {
          try {
            msg.payload = JSON.parse(msg.Message);
          } catch (e) {
            node.error("payload is not json:" + e)
          }
        } else {
          msg.payload = msg.Message
        }
        node.send(msg);
      }

      this.on('close', function (done) {
        node.connNode.deregister(node, done);
      })
    } else {
      this.error("connection node not defined");
    }

  }
  RED.nodes.registerType("rcon query", WSRconQuery);

  // ====== listen node ===== \\
  function WSRconListen(n) {
    RED.nodes.createNode(this, n);

    // this.name = n.name;
    this.connection = n.connection;
    this.listenType = n.listenType;

    this.connNode = RED.nodes.getNode(this.connection);

    var node = this;

    if (this.connNode) {
      this.status({ fill: "red", shape: "ring", text: "disconnected" });

      // register on connection config node
      this.connNode.register(node)
      this.connNode.registerListen(this.listenType, this)

      this.onRConMSG = function (msg) {
        msg.payload = msg.Message
        node.send(msg);
      }

      this.onConnState = function (state) { }

      this.on('close', function (done) {
        node.connNode.deregister(node, done);
      })
    } else {
      this.error("connection node not defined");
    }

  }
  RED.nodes.registerType("rcon listen", WSRconListen);
}