const __DEVTOOL__ = (() => {
  try {
    require("jerni-dev");
    return true;
  } catch (ex) {
    return false;
  }
})();

exports.getDevServerUrl = async providedServerUrl => {
  if (!__DEVTOOL__) return providedServerUrl;

  return require("jerni-dev").getDevServerUrl(providedServerUrl);
};
exports.waitTooLongExplain = ({ stores, event }) => {
  if (!__DEVTOOL__) return;

  return require("jerni-dev").waitTooLongExplain({ stores, event });
};