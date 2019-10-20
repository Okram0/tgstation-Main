let socket;
const queue = [];
const subscribers = [];

const ensureConnection = () => {
  if (process.env.NODE_ENV !== 'production') {
    if (!window.WebSocket) {
      return;
    }
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      socket = new WebSocket('ws://127.0.0.1:3000');
      socket.onopen = () => {
        // Empty the message queue
        while (queue.length !== 0) {
          const msg = queue.shift();
          socket.send(msg);
        }
      };
      socket.onmessage = event => {
        const msg = JSON.parse(event.data);
        for (let subscriber of subscribers) {
          subscriber(msg);
        }
      };
    }
  }
};

if (process.env.NODE_ENV !== 'production') {
  window.onunload = () => socket && socket.close();
}

const subscribe = fn => subscribers.push(fn);

/**
 * A json serializer which handles circular references and other junk.
 */
const serializeObject = obj => {
  let cache = [];
  const json = JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.indexOf(value) !== -1) {
        return '[circular ref]';
      }
      cache.push(value);
      return value;
    }
    return value;
  });
  cache = null;
  return json;
};

const sendRawMessage = msg => {
  if (process.env.NODE_ENV !== 'production') {
    const json = serializeObject(msg);
    // Send message using WebSocket
    if (window.WebSocket) {
      ensureConnection();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(json);
      }
      else {
        // Keep only 10 latest messages in the queue
        if (queue.length > 10) {
          queue.shift();
        }
        queue.push(json);
      }
    }
    // Send message using plain HTTP request.
    else {
      const req = new XMLHttpRequest();
      req.open('POST', 'http://127.0.0.1:3001', true);
      req.send(json);
    }
  }
};

export const sendLogEntry = (level, ns, ...args) => {
  if (process.env.NODE_ENV !== 'production') {
    try {
      sendRawMessage({
        type: 'log',
        payload: {
          level,
          ns: ns || 'client',
          args,
        },
      });
    }
    catch (err) {}
  }
};

export const setupHotReloading = () => {
  if (process.env.NODE_ENV !== 'production'
      && process.env.WEBPACK_HMR_ENABLED
      && window.WebSocket) {
    if (module.hot) {
      ensureConnection();
      sendLogEntry(0, null, 'setting up hot reloading');
      subscribe(msg => {
        const { type } = msg;
        sendLogEntry(0, null, 'received', type);
        if (type === 'hotUpdate') {
          const status = module.hot.status();
          if (status !== 'idle') {
            sendLogEntry(0, null, 'hot reload status:', status);
            return;
          }
          module.hot
            .check({
              ignoreUnaccepted: true,
              ignoreDeclined: true,
              ignoreErrored: true,
            })
            .then(modules => {
              sendLogEntry(0, null, 'outdated modules', modules);
            })
            .catch(err => {
              sendLogEntry(0, null, 'reload error', err);
            });
        }
      });
    }
  }
};
