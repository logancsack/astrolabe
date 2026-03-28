require("dotenv").config();

const { createConfig, normalizeHighStakesConfirmMode, normalizeRoutingProfile } = require("./src/config");
const { createAstrolabeApp } = require("./src/app");

const config = createConfig(process.env);
const { app, startServer, internals } = createAstrolabeApp(config);

module.exports = {
  app,
  config,
  startServer,
  internals: {
    ...internals,
    normalizeHighStakesConfirmMode,
    normalizeRoutingProfile,
    ROUTING_PROFILE: config.ROUTING_PROFILE,
    COST_EFFICIENCY_MODE: config.COST_EFFICIENCY_MODE,
    DEFAULT_PROFILE: config.DEFAULT_PROFILE
  }
};

if (require.main === module) {
  startServer();
}
