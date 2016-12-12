"use strict";
var events = require('events');
var util = require('util');

function PausableEmitter() {
    var that = this;

    // Private fields
    that._queue = [];
    that._paused = false;

    // Private API
    var _pause = function (pause) {
        that._paused = pause;
    };

    var _fire = function () {
        while (that._queue.length > 0 && !that._paused) {
            var event = that._queue.shift();
            // Use base object's emit method
            that.emit(event.name, event.arg);
        }
    };

    var _enqueue = function (event, arg, immediate) {
        that._queue.push({name: event, arg: arg});
        if (immediate) {
            _pause(immediate);
        }
        _fire();
    };

    // Public API
    that.enqueue = _enqueue;
    that.fire = _fire;
    that.pause = _pause;

    // EventEmitter inheritance setup
    events.EventEmitter.call(that);
    return that;
}

module.exports = PausableEmitter;

util.inherits(PausableEmitter, events.EventEmitter);