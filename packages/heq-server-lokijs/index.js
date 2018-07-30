const Loki = require('lokijs');
const mitt = require('mitt');
const kefir = require('kefir');

const delokize = obj => {
  const { $loki, ...event } = { ...obj };
  event.meta = { ...obj.meta };

  event.id = $loki;

  delete event.meta.created;
  delete event.meta.revision;
  delete event.meta.version;

  if (Object.keys(event.meta).length === 0) {
    delete event.meta;
  }

  return event;
};

const defer = () => {
  let resolve, reject;
  const promise = new Promise((_res, _rej) => {
    resolve = _res;
    reject = _rej;
  });

  return { promise, resolve, reject };
};

const adapter = ({ ns = 'local' }) => {
  const emitter = mitt();
  const { promise: events, resolve: done } = defer();
  let latest = null;

  const db = new Loki('heq-events.db', {
    autosave: true,
    autoload: true,
    autosaveInterval: 4000,
    autoloadCallback: () => {
      let coll = db.getCollection(ns);

      if (coll == null) {
        coll = db.addCollection(ns);
      }

      done(coll);
    },
  });

  const commit = async event => {
    latest = (await events).insert({ ...event, meta: { ...event.meta } });
    emitter.emit('data', latest);
    event.id = latest.$loki;

    return event;
  };

  const getLatest = async () => {
    return latest ? delokize(latest) : { id: 0, type: '@@INIT' };
  };

  const query = async ({ from = -1, to }) => {
    if (from === -1) {
      return [];
    }

    if (to) {
      return (await events)
        .find({ $loki: { $between: [from + 1, to] } })
        .map(delokize);
    }

    return (await events).find({ $loki: { $gt: from } }).map(delokize);
  };

  const subscribe = () => ({
    events$: kefir.fromEvents(emitter, 'data').map(delokize),
  });

  const destroy = () => {
    // noop
  };

  return { commit, subscribe, query, destroy, getLatest };
};

module.exports = adapter;
