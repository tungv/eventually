const brighten = require('brighten');
const subscribe = require('../lib/subscribe');
const initStore = require('../lib/initStore');
const test = require('ava');
const makeServer = require('./makeServer');
const {
  Model: DummyModel,
  Connection: DummyConnection,
} = require('./DummyConnection');

test('should subscribe', async t => {
  brighten();
  const { queue, server } = await makeServer({
    ns: 'test_subscribe',
    port: 19090,
  });

  const dummyConnection = new DummyConnection({
    name: 'conn_0',
    models: [],
  });

  const store = initStore({
    writeTo: 'http://localhost:19090',
    readFrom: [dummyConnection],
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: 'TEST',
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }

  await sleep(100);

  const stream = await subscribe({
    subscribeURL: 'http://localhost:19090/subscribe',
    queryURL: 'http://localhost:19090/query',
    lastSeenId: 0,
  });

  const events = [];

  stream.observe(incomingEvents => {
    events.push(...incomingEvents);
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: 'TEST',
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }
  server.close();

  await sleep(100);
  const length = events.length;
  t.true(length === 20);
});

test('should subscribe with filter', async t => {
  brighten();
  const { queue, server } = await makeServer({
    ns: 'test_subscribe',
    port: 19091,
  });

  const dummyConnection = new DummyConnection({
    name: 'conn_0',
    models: [],
  });

  const store = initStore({
    writeTo: 'http://localhost:19091',
    readFrom: [dummyConnection],
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: `TEST_${i % 4}`,
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }

  await sleep(100);

  const stream = await subscribe({
    subscribeURL: 'http://localhost:19091/subscribe',
    queryURL: 'http://localhost:19091/query',
    lastSeenId: 0,
    includes: ['TEST_1', 'TEST_3'],
  });

  const events = [];

  stream.observe(incomingEvents => {
    events.push(...incomingEvents);
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: `TEST_${i % 4}`,
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }
  server.close();

  await sleep(100);
  const length = events.length;
  t.true(length === 10);
  t.deepEqual(events.map(event => event.id), [
    2,
    4,
    6,
    8,
    10,
    12,
    14,
    16,
    18,
    20,
  ]);
});

test('await store.subscribe()', async t => {
  brighten();
  const { queue, server } = await makeServer({
    ns: 'test_subscribe',
    port: 19092,
  });

  const model1 = new DummyModel({ name: 'internal_1' });
  const model2 = new DummyModel({ name: 'internal_2' });

  const dummyConnection = new DummyConnection({
    name: 'conn_0',
    models: [model1, model2],
  });

  const store = initStore({
    writeTo: 'http://localhost:19092',
    readFrom: [dummyConnection],
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: 'TEST',
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }

  await sleep(100);

  const stream = await store.subscribe();

  const outputs = [];

  stream.observe(output => {
    outputs.push(output);
  });

  for (let i = 0; i < 10; ++i) {
    await store.commit({
      type: 'TEST',
      payload: { key: 'value' },
      meta: { some: 'meta' },
    });
  }
  server.close();

  await sleep(100);

  // 4 outputs
  // 1. first patch (10 events) id:4 and id:8 will match
  // 2. id:12
  // 3. id:16
  // 4. id:20

  t.true(outputs.length === 4);
  t.deepEqual(outputs.map(out => out.source), [
    dummyConnection,
    dummyConnection,
    dummyConnection,
    dummyConnection,
  ]);

  t.deepEqual(outputs.map(out => out.output.events.map(event => event.id)), [
    [4, 8],
    [12],
    [16],
    [20],
  ]);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
