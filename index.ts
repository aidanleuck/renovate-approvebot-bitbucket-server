/**
 * Entry point for the application
 */

import * as bot from './src/bot';

// Export all functions from the bot
export default bot;

// Run main if this is the main module
if (require.main === module) {
  bot.main();
}
