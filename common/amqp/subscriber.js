'use strict';

var events = require('events');
var util = require('util');
var amqp = require('amqplib');

module.exports = Subscriber;

util.inherits(Subscriber, events.EventEmitter);

function Subscriber(config, logger, opts) {
    var that = this;

    var url = 'amqp://' +
        config.amqp.login + ':' +
        config.amqp.password + '@' +
        config.amqp.host + ':' +
        config.amqp.port + '/' +
        config.amqp.vhost;
    var exchangeOpts = {
        exchange: config.amqp.exchange,
        pattern: opts.topic || 'Anapos.Projection.ProjectionChanged',
        routing: opts.routingType || 'topic'
    };
    var qOpts = {
        durable: opts.durable || true,
        autoDelete: opts.autoDelete || false
    };
    var qName = opts.qName || 'projection.ee';

    amqp.connect(url).then(function(conn) {
        return conn.createChannel().then(function(ch) {

            function handleMsg(msg) {
                that.emit('data', { header: msg.properties, body: msg.content });
            }

            ch.on('error', function() {
                conn.close();
            });

            var ok = ch.checkExchange(exchangeOpts.exchange, exchangeOpts.routing);

            ok = ok.then(function() {
                return ch.assertQueue(qName, qOpts)
                    .then(function(queueOk) {
                        return queueOk.queue;
                    });
            });

            ok = ok.then(function(replyQueue) {
                return ch.bindQueue(replyQueue, exchangeOpts.exchange, exchangeOpts.pattern)
                    .then(function() {
                        return replyQueue;
                    });
            });

            ok = ok.then(function(replyQueue) {
                return ch.consume(replyQueue, handleMsg, { noAck: true });
            });

            return ok;
        });
    }).then(null, function(err) {
        logger.log('error', err);
    });
}
