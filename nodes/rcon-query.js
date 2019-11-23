module.exports = function (RED) {
  "use strict";

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
        if (node.command) msg.payload = { payload: node.command };
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
}