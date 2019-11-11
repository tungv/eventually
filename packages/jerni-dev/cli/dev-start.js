const { watch } = require("chokidar");
const path = require("path");
const fs = require("fs");
const debounce = require("debounce");
const getLogger = require("./dev-logger");

const { checksumFile, writeChecksum } = require("./fsQueue");
const { start } = require("./background");

const cwd = process.cwd();
const pkgDir = require("pkg-dir");

module.exports = async function(filepath, opts) {
  let address, killServer, deps, stopJourney;
  const absolutePath = path.resolve(cwd, filepath);
  const rootDir = pkgDir.sync(absolutePath);
  const logger = getLogger({ service: " cli ", verbose: opts.verbose });
  logger.info("jerni-dev.start");
  logger.info("source file: %s", absolutePath);
  logger.info("options %o", {
    http: opts.http,
    verbose: opts.verbose,
    dataPath: opts.dataPath,
  });

  const dataPath = opts.dataPath;

  const [current, original] = checksumFile(dataPath);

  process.on("SIGINT", () => {
    logger.warn("interuptted! cleaning up…");
    if (killServer) killServer();
    if (stopJourney) stopJourney();
    logger.info("exiting…");
  });

  await startServer();

  if (current !== original) {
    writeChecksum(dataPath, current);
  }

  await startJerni({ cleanStart: current !== original });

  // listen
  // watch data file
  let corrupted = false;
  onFileChange(dataPath, async () => {
    try {
      const [current, original] = checksumFile(dataPath);

      if (!corrupted && current === original) {
        logger.debug("organic change");
        return;
      }

      if (corrupted) {
        logger.info("attemp to recover from corrupted data file");
        corrupted = false;
      } else {
        logger.warn("non-organic change detected!");
        logger.debug("  original checksum %s", original);
        logger.debug("   current checksum %s", current);
      }

      logger.debug("stopping heq-server");
      killServer();

      logger.debug("stopping jerni");
      stopJourney();

      // rewrite checksum
      logger.debug("overwrite checksum with %s", current);
      writeChecksum(dataPath, current);

      await startJerni({ cleanStart: true });
      await startServer();
    } catch (ex) {
      killServer();
      stopJourney();
      corrupted = true;
      // process.exit(1);
    }
  });

  async function startServer() {
    logger.debug("starting heq-server…");
    const output = await start(path.resolve(__dirname, "./worker-heq-server"), {
      port: opts.http,
      dataPath,
      verbose: opts.verbose,
    });
    address = output[0];
    const lockfilePath = path.resolve(rootDir, ".jerni-dev");

    logger.info("writing lockfile to %s", path.relative(cwd, lockfilePath));
    fs.writeFileSync(lockfilePath, String(address.port));
    killServer = function() {
      logger.info("stopping heq-server subprocess…");
      output[1]();
      logger.info("removing lockfile at %s", lockfilePath);
      fs.unlinkSync(lockfilePath);
    };
    logger.info("heq-server is listening on port %d", address.port);
  }

  async function startJerni({ cleanStart }) {
    if (cleanStart) logger.info("clean start new journey");
    let output = await start(path.resolve(__dirname, "./worker-jerni"), {
      absolutePath,
      cleanStart,
      heqServerAddress: `http://localhost:${address.port}`,
      verbose: opts.verbose,
    });

    deps = output[0];
    stopJourney = function() {
      logger.info("stopping jerni subprocess…");
      output[1]();
    };
    logger.info("worker ready");

    logger.debug("watching %d files:", deps.length);
    deps.slice(0, 20).forEach((file, index) => {
      logger.debug("%d. %s", index + 1, path.relative(process.cwd(), file));
    });
    if (deps.length >= 20) {
      logger.debug("and %d more…", deps.length - 20);
    }

    const close = onFileChange(
      deps,
      debounce(async file => {
        logger.debug("file changed: %s", path.relative(process.cwd(), file));
        logger.info("hot reloading…");

        await close();
        stopJourney();

        startJerni({ cleanStart: true });
      }, 300),
    );
  }
};

function onFileChange(paths, handler) {
  const watcher = watch(paths);
  watcher.on("change", file => {
    handler(file);
  });

  return () => watcher.close();
}
