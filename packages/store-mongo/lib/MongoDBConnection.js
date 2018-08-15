const MongoHeartbeat = require('mongo-heartbeat');

const Connection = require('heq-store/lib/Connection');
const PLazy = require('p-lazy');
const kefir = require('kefir');

const MongoClient = require('mongodb').MongoClient;
const makeDefer = require('./makeDefer');
const watch = require('./watch');
const transform = require('./transform');

const SNAPSHOT_COLLECTION_NAME = '__snapshots_v1.0.0';

const flatten = arrayDeep => [].concat(...arrayDeep);

const connect = async url => {
  const client = await MongoClient.connect(
    url,
    { useNewUrlParser: true }
  );
  return client;
};

module.exports = class MongoDBConnection extends Connection {
  constructor({
    name,
    url,
    dbName,
    models,
    buffer = {
      time: 2,
      count: 100,
    },
  }) {
    super({ name, models });
    this.buffer = buffer;
    this.listeners = [];
    this.connectionInfo = {
      url,
      dbName,
    };

    this.connected = makeDefer();

    this.actuallyConnect().then(async conn => {
      this.connection = conn;

      this.connected.resolve();

      // get change stream from __snapshots collection
      const snapshotsCol = conn.db.collection(SNAPSHOT_COLLECTION_NAME);

      const change$ = watch(conn.client, snapshotsCol, this.models);

      change$.observe(id => {
        this.lastReceivedEventId = id;
        this.listeners.forEach(fn => fn(id));
      });
    });
  }

  get latestEventId() {
    return this.lastReceivedEventId;
  }

  async clean() {
    await this.connected.promise;

    const { db } = this.connection;
    const promises = this.models.map(m => {
      const col = db.collection(m.collectionName);
      return col.deleteMany({});
    });

    const condition = {
      $or: this.models.map(m => ({ name: m.name, version: m.version })),
    };

    promises.push(
      db.collection(SNAPSHOT_COLLECTION_NAME).deleteMany(condition)
    );

    await Promise.all(promises);
  }

  async actuallyConnect() {
    try {
      const client = await connect(this.connectionInfo.url);
      const db = client.db(this.connectionInfo.dbName);
      const hb = MongoHeartbeat(db, {
        interval: 5 * 60 * 1000,
        timeout: 30000,
        tolerance: 3,
      });

      hb.on('error', err => {
        console.error('mongodb didnt respond the heartbeat message');
        process.nextTick(function() {
          process.exit(1);
        });
      });
      return { client, db };
    } catch (ex) {
      console.error(ex);
      process.exit(1);
    }
  }

  async getDriver(model) {
    await this.connected.promise;

    return this.connection.db.collection(model.collectionName);
  }

  subscribe(fn) {
    this.listeners.push(fn);

    // unsubscribe
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== fn);
    };
  }

  async receive(kefirStreamOfBatchedEvents) {
    await this.connected.promise;

    const conn = this.connection;

    const snapshotsCol = conn.db.collection(SNAPSHOT_COLLECTION_NAME);

    const transformEvent = events =>
      new PLazy(resolve => {
        const allPromises = this.models.map(async model => {
          const ops = flatten(
            events.map(event => transform(model.transform, event))
          );

          const coll = conn.db.collection(model.collectionName);
          const modelOpsResult = await coll.bulkWrite(ops);

          await snapshotsCol.findOneAndUpdate(
            {
              name: model.name,
              version: model.version,
            },
            {
              $set: { __v: events[events.length - 1].id },
            },
            {
              upsert: true,
            }
          );

          return {
            events,
            model: model.collectionName,
            added: modelOpsResult.nUpserted,
            modified: modelOpsResult.nModified,
            removed: modelOpsResult.nRemoved,
          };
        });

        return Promise.all(allPromises).then(resolve);
      });

    return kefirStreamOfBatchedEvents
      .flatten()
      .bufferWithTimeOrCount(this.buffer.time, this.buffer.count)
      .filter(buf => buf.length)
      .flatMapConcat(events => kefir.fromPromise(transformEvent(events)));
  }
};