const mitt = require('mitt');
const kefir = require('kefir');

const adapter = () => {
  const emitter = mitt();
  const events = [];
  let id = 0;

  const commit = event => {
    events[id] = event;
    event.id = ++id;
    // console.log('commit', id);
    emitter.emit('data', event);
    return event;
  };

  const query = ({ from, to = id }) => {
    // console.log('query', { from, to });
    return events.slice(from, to);
  };

  const subscribe = () => {
    // console.log('subscribe', { id });
    const events$ = kefir.fromEvents(emitter, 'data');
    const latest = id;

    return { latest, events$ };
  };

  return { commit, subscribe, query };
};

module.exports = adapter;
