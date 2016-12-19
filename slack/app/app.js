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

var Source = 'Slack App';

var configSettings = config('anapos');
var slackSettings = config('slack');

configSettings = helpers.myConfig(configSettings);  // Substitute any $machine$ settings on DEV

slackSettings.bots.forEach(function (bot) {

    //get the bot token and place into settings
    var tokenEnvVariableName = util.format('SLACK_TOKEN_%s', bot.requestedResource.toUpperCase());
    var token = process.env[tokenEnvVariableName];

    if(!token) {
        throw Error(util.format('No slackbot token found for %s. Expecting env variable named: %s', bot.requestedResource, tokenEnvVariableName));
    }

    bot.settings.slackToken = token;
});

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

restServer.use(restify.queryParser());
restServer.use(restify.bodyParser({mapParams: false})); // It's important to include this before any custom async middleware (https://github.com/mcavage/node-restify/issues/287)

restServer.use(function (req, res, next) {
    var HTTP_OK = 200;
    //required for initial slack configuration:
    //slack validates urls setup for use with its events api
    //Slack validates by sending an initial request containing a challenge. The http endpoint
    //must respond with the challenge.
    if(req.body.challenge) {
        res.setHeader("content-type","application/json")
        res.send(HTTP_OK, {"challenge": req.body.challenge});
        return;
    }

    return next();
});

restServer.use(function(req, res, next){
    var HTTP_NOTFOUND = 404;
    var slackToken = process.env.SLACK_VERIFICATION_TOKEN;

    if (!slackToken || !req.body.token || slackToken !== req.body.token) {
        res.send(HTTP_NOTFOUND);
        return;
    }

    return next();
});

restServer.use(function(req, res, next){
    if(!process.env.NODE_ENV || process.env.NODE_ENV === "DEVELOPMENT") {
        _logger.log('info', "Received request: " + JSON.stringify(req.body));
    }

    return next();
});

restServer.use(function (req, res, next) {
    var ensureRequestIsValid = function (req, res, next) {
        var HTTP_NOTFOUND = 404;
        var HTTP_OK = 200;

        var shouldHandle = function (evt) {
            var handledEventType = "message";
            return (evt.type === handledEventType && !evt.bot_id);
        }

        if (!req.body.event || !req.body.event.type || !req.body.event.channel) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        //no action required for message types that are not handled, just return HTTP_OK
        if (!shouldHandle(req.body.event)) {
            res.send(HTTP_OK);
            return;
        }

        return next();
    };

    ensureRequestIsValid(req, res, next);
});

restServer.use(function (req, res, next) {
    var ensureUserIsAuthorized = function (req, res, next) {
        var HTTP_OK = 200;

        var serviceRequest;
        if (req.params) {
            if (req.params[1]) {
                serviceRequest = req.params[1];
            } else if (req.params[0]) {
                serviceRequest = req.params[0];
            }
        }

        var botConfig = und.filter(slackSettings.bots, function(x) {
            return x.requestedResource === serviceRequest;
        })[0];

        if(!botConfig) {
            res.send(HTTP_OK);
            return;
        }

        var authorizedUsers = botConfig.settings.authorizedUsers;

        if(!authorizedUsers) {
            res.send(HTTP_OK);
            return;
        }

        var userIdLocations = [
            {prop: req.body.event.user,     selector: function() {return req.body.event.user}},
            {prop: req.body.event.message,  selector: function() {return req.body.event.message.user}},
            {prop: req.body.event.comment,  selector: function() {return req.body.event.comment.user}}
        ];

        var userIdSelector = und.filter(userIdLocations, function(x){return x.prop})[0];
        if(!userIdSelector) {
            res.send(HTTP_OK);
            return;
        }

        var userId = userIdSelector.selector();
        if (!userId) {
            res.send(HTTP_OK);
            return;
        }

        var authorizedEntry = und.filter(authorizedUsers, function (x) {
            return x.id === userId;
        })[0];

        if (!authorizedEntry) {
            res.send(HTTP_OK);
            return;
        }

        res.header('x-username', authorizedEntry.name);

        return next();
    };

    ensureUserIsAuthorized(req, res, next);
});

restServer.use(function (req, res, next) {
    var support_id = req.headers['x-support-id'] || _logger.supportId();
    if (!res.header('x-support-id')) {
        res.header('x-support-id', support_id);
    }

    return next();
});

restServer.use(restify.gzipResponse());

restServer.post(/\/bots\/(supportbot)/, requestEngine.sendRequest);
restServer.post(/\/bots\/(adminbot)/, requestEngine.sendRequest);

var port = process.env.port || 1337;
restServer.listen(port, function () {
    var msg = util.format('%s:Listening on port %d', Source, port);
    _logger.log('info', msg);
});