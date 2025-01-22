var Application = require("./lib/app");
var Server      = require("./lib/server");
var sdk         = require("./lib/sdk");
var config      = require("./config");

var app    = new Application(null, config);
var server = new Server(config, app);
var routes=app.load() 
module.exports=routes;

sdk.checkNodeVersion();

server.start();

sdk.registerBot(require('./SimpleConversationalBot.js'));
sdk.registerBot(require('./BotVariables.js'));
// sdk.registerBot(require('./LiveChat.js'));

