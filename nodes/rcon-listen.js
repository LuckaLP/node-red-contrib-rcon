module.exports = function (RED) {
  "use strict";

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