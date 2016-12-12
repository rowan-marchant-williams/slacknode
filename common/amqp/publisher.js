'use strict';

var amqp = require('amqplib');
var Q = require('q');

module.exports = Publisher;

function Publisher(config) {
    this.url = 'amqp://' +
        config.amqp.login + ':' +
        config.amqp.password + '@' +
        config.amqp.host + ':' +
        config.amqp.port + '/' +
        config.amqp.vhost;
    this.exchange = config.amqp.exchange;
}

Publisher.prototype.publish = function(message, messageId, routingKey, cb) {
    var that = this;

    var maybeCb = function() {
        if (cb) cb();
    };

    amqp.connect(that.url).then(function(conn) {

        return Q(conn.createChannel().then(function(ch) {

            var ok = ch.checkExchange(that.exchange, 'topic');

            return ok.then(function() {
                ch.publish(that.exchange, routingKey, message, { messageId: messageId });
                return ch.close();
            });
        })).fin(function() {
            conn.close();
        });
    }).then(maybeCb, maybeCb);
};


