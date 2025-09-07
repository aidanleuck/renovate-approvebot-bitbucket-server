/**
 * Entry point for the application
 */

const bot = require('./src/bot');

// Export all functions from the bot
module.exports = bot;

// Run main if this is the main module
if (require.main === module) {
  bot.main();
}
