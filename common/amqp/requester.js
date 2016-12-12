'use strict';

var events = require('events');
var util = require('util');
var amqp = require('amqplib');
var Q = require('q');
var uuid = require('node-uuid');

module.exports = Requester;

util.inherits(Requester, events.EventEmitter);

function Requester(config) {
    this.url = 'amqp://' +
        config.amqp.login + ':' +
        config.amqp.password + '@' +
        config.amqp.host + ':' +
        config.amqp.port + '/' +
        config.amqp.vhost;
    this.queue = config.amqp.qName;
    this.ttl = config.amqp.ttl;
    events.EventEmitter.call(this);
}

Requester.prototype.send = function(sendOptions, buffer) {
    var that = this;

    amqp.connect(that.url).then(function(conn) {

        return Q(conn.createChannel().then(function(ch) {
            var answer = Q.defer();
            var corrId = uuid();

            function handleMsg(msg) {
                if (msg.properties.correlationId === corrId) {
                    answer.resolve(msg);
                }
            }

            var ok = ch.checkQueue(that.queue);

            ok = ok.then(function() {
                return ch.assertQueue('', { exclusive: true, autoDelete: true })
                    .then(function(queueOk) {
                        return queueOk.queue;
                    });
            });

            ok = ok.then(function(replyQueue) {
                return ch.consume(replyQueue, handleMsg, { noAck: true })
                    .then(function() {
                        return replyQueue;
                    });
            });

            ok = ok.then(function(replyQueue) {
                ch.sendToQueue(that.queue, buffer, {
                    correlationId: corrId,
                    headers: sendOptions.headers,
                    messageId: sendOptions.messageId,
                    replyTo: replyQueue
                });

                setTimeout(function() {
                    answer.reject('request timeout');
                }, that.ttl);

                return answer.promise;
            });

            return ok;
        })).fin(function() {
            conn.close();
        });
    }).then(function(msg) {
        that.emit('data', msg.content, msg.properties);
    }, function(err) {
        that.emit('error', err);
    });
};