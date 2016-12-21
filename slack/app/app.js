'use strict';

var common  = __dirname + '/../../common/';
var restify = require(common + 'node_modules/restify');
var config  = require('konphyg')(common + 'config');
var Logger  = require(common + 'logging/logger');
var RequestEngine = require('./modules/request-engine');
var uuid    = require('node-uuid');
var util    = require('util');
var helpers = require(common + 'utils/helpers');
var Resourcing = require(common + 'resourcing');
var und = require('underscore');
var SlackRequest = require('./modules/slack-request');

var Source = 'Slack App';

var configSettings = config('anapos');
var slackSettings = config('slack');

configSettings = helpers.myConfig(configSettings);  // Substitute any $machine$ settings on DEV

var setBotVerificationAndAccessTokens = function(bot) {
    var verificationEnvVariableName = util.format('SLACK_VERIFICATION_%s', bot.requestedResource.toUpperCase());
    var verification = process.env[verificationEnvVariableName];
    if(!verification) {
        throw Error(util.format('No slackbot verification token found for %s. Expecting env variable named: %s', bot.requestedResource, verificationEnvVariableName));
    }

    var tokenEnvVariableName = util.format('SLACK_TOKEN_%s', bot.requestedResource.toUpperCase());
    var token = process.env[tokenEnvVariableName];
    if(!token) {
        throw Error(util.format('No slackbot token found for %s. Expecting env variable named: %s', bot.requestedResource, tokenEnvVariableName));
    }

    bot.settings.slackVerification = verification;
    bot.settings.slackToken = token;
};

slackSettings.bots.forEach(setBotVerificationAndAccessTokens);

var _logger = (function configureLogging() {
    var loggerOptions = configSettings.logging || {
            tenantCode: 'i2OGB',
            logFile: 'anapos.log',
            level: 'debug',
            colorize: true
        };
    loggerOptions.supportId = uuid.v1();
    loggerOptions.source = Source;
    loggerOptions.cfg = configSettings;

    return new Logger(loggerOptions);
})();

var resourcing = new Resourcing(configSettings);

process.on('uncaughtException', function (err) {
    var logMessage = util.format('%s:Uncaught Exception(%s)', Source, err.message);
    _logger.log('error', logMessage, err);
    process.exit(1);
});

var restServer = restify.createServer({
    name: Source,
    version: '1.0.0'
});

restServer.on('error', function (err) {
    var msg = util.format('%s:REST Server Error(%s)', Source, err.message);
    _logger.log('error', msg, err);
});

restServer.on('clientError', function (err) {
    var msg = util.format('%s:Client Error(%s)', Source, err.message);
    _logger.log('error', msg, err);
});

var requestEngine = new RequestEngine(restServer, _logger, configSettings, slackSettings);
var slackRequest = new SlackRequest(_logger, slackSettings);

restServer.use(restify.queryParser());
restServer.use(restify.bodyParser({mapParams: false})); // It's important to include this before any custom async middleware (https://github.com/mcavage/node-restify/issues/287)

restServer.use(slackRequest.replyWithChallenge);

restServer.use(slackRequest.ensureSlackVerificationToken);

restServer.use(slackRequest.logInDebug);

restServer.use(slackRequest.ensureRequestIsValid);

restServer.use(slackRequest.ensureUserIsAuthorized);

restServer.use(slackRequest.addSupportIdHeader);

restServer.use(restify.gzipResponse());

restServer.post(/\/bots\/(supportbot)/, requestEngine.sendRequest);
restServer.post(/\/bots\/(adminbot)/, requestEngine.sendRequest);

var port = process.env.port || 1337;
restServer.listen(port, function () {
    var msg = util.format('%s:Listening on port %d', Source, port);
    _logger.log('info', msg);
});