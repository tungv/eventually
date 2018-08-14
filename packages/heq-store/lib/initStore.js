const commitEventToHeqServer = require('./commit');
const makeRacer = require('./racer');
const getEventsStream = require('./subscribe');
const kefir = require('kefir');

module.exports = function initStore({ writeTo, readFrom }) {
  const SOURCE_BY_MODELS = new Map();
  const racer = makeRacer(readFrom.map(() => 0));

  readFrom.forEach((readSource, index) => {
    // register every models in each read source to SOURCE_BY_MODELS map
    // so we can retrieve them later in `#read(model)`
    readSource.registerModels(SOURCE_BY_MODELS);

    // we also subscribe for new changes from each source
    // in order to resolve `#waitFor(event)` and future `#waitFor(event, model)`
    readSource.subscribe(id => {
      racer.bump(index, id);
    });
  });

  const read = model => {
    const source = SOURCE_BY_MODELS.get(model);

    if (source) {
      return source.getDriver(model);
    }

    throw new Error(`trying to read an unregistered model`);
  };

  const commit = event => {
    return commitEventToHeqServer(`${writeTo}/commit`, event);
  };

  const waitFor = event => {
    return racer.wait(event.id);
  };

  const subscribe = async () => {
    const incomingEvents$ = await getEventsStream({
      queryURL: `${writeTo}/query`,
      subscribeURL: `${writeTo}/subscribe`,
      lastSeenId: 0,
    });

    const output$PromiseArray = readFrom.map(source => {
      return source.receive(incomingEvents$).then(stream =>
        stream.map(output => ({
          source,
          output,
        }))
      );
    });

    const output$Array = await Promise.all(output$PromiseArray);

    return kefir.merge(output$Array);
  };

  return {
    read,
    commit,
    waitFor,
    subscribe,
  };
};
