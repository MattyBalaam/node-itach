const net = require("net");
const { EventEmitter } = require("events");
const itach = new EventEmitter();
const { options, ERRORCODES } = require("./config");
const { createQueue } = require("./utils");
let socket;

const queue = createQueue(data => {
  return new Promise((resolve, reject) => {
    let stream = "";
    let wait;
    socket.removeAllListeners("data");
    socket.on("data", response => {
      stream += response;
      if (stream.startsWith("ERR_")) {
        const errorCode = stream.slice(-4, -1);
        reject(new Error(ERRORCODES[errorCode]));
      } else if (stream.startsWith("busyIR")) {
        setTimeout(() => socket.write(data), options.retryInterval);
      } else {
        clearTimeout(wait);
        wait = setTimeout(() => {
          const responses = stream.split("\r");
          if (responses.pop().length) {
            return;
          }
          resolve(responses);
        }, options.streamDelay);
      }
    });
    socket.write(data);
  });
}, 1);

queue.pause();

itach.setOptions = opts => {
  if (opts === undefined) return;
  Object.entries(opts).forEach(([key, value]) => {
    options[key] = value;
  });
};

itach.close = opts => {
  itach.setOptions(opts);
  queue.pause();
  socket.destroy();

  if (options.reconnect) {
    setTimeout(itach.connect, options.reconnectInterval);
  }
};

itach.connect = opts => {
  itach.setOptions(opts);

  const connectionTimeout = setTimeout(() => {
    setImmediate(() => socket.destroy("Connection timeout."));
  }, options.connectionTimeout);

  if (socket === undefined) {
    socket = net.connect({ host: options.host, port: options.port });
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      clearTimeout(connectionTimeout);
      queue.resume();
      itach.emit("connect");
    });

    socket.on("close", () => {
      queue.pause();
      itach.emit("close");
    });

    socket.on("error", error => {
      queue.pause();
      itach.emit("error", new Error(error));
    });
  } else if (socket.remoteAddress === undefined) {
    socket.connect({ host: options.host, port: options.port });
  }
};

itach.send = data => {
  return queue.push(
    data.includes("\r") ? data : data + "\r",
    options.sendTimeout
  );
};

module.exports = itach;
