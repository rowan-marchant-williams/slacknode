var config = require('konphyg')(__dirname + '/config');
require('should');
var assert = require('assert');
var fs = require('fs');
var common = '../';
var helpers = require(common + 'utils/helpers.js');
var Cache = require(common + 'cache.js');
var sinon = require('../node_modules/sinon');

describe('Cache', function () {
    var pathToExpectedFile = __dirname + '/data/index.json';

    describe('Basic Needs', function () {
        it('Can put a static resource in the cache by etag', function (done) {

            var spyCache = {
                hmset:function (key, value, cb) {
                    if (cb) {
                        cb();
                    }
                }
            };

            var cache = new Cache(spyCache);
            fs.readFile(pathToExpectedFile, function (err, data) {
                helpers.calcEtag(pathToExpectedFile, function (err, etag) {
                    cache.storeSingleHash(etag, data, function () {
                        done();
                    });
                });
            });
        });

        it('Can get a static resource from the cache by etag', function (done) {
            var spyCache = {
                hgetall:function (key, cb) {
                    if (cb) {
                        cb();
                    }
                }
            };

            var cache = new Cache(spyCache);
            helpers.calcEtag(pathToExpectedFile, function (err, etag) {
                cache.retrieveSingleHash(etag, function () {
                    done();
                });
            });
        });

        it('Can put a complex object into the cache', function (done) {
            var testKey = 'my-object-key';
            var theObject = {
                a: 3,
                b: {
                    x: 'string',
                    y: null,
                    z: 3.4
                }
            };
            var spyCache = {
                set: sinon.stub().callsArg(2)
            };

            var cache = new Cache(spyCache);
            cache.storeObject(testKey, theObject, function () {
                assert(spyCache.set.calledWith(testKey, JSON.stringify(theObject)));
                done();
            });
        });

        it('Can retrieve a complex object from the cache', function (done) {
            var testKey = 'my-object-key';
            var objectJson = '{"a":3,"b":{"x":"string","y":null,"z":3.4}}';
            var spyCache = {
                get: sinon.stub().callsArgWith(1, null, objectJson)
            };

            var cache = new Cache(spyCache);
            cache.retrieveObject(testKey, function (err, result) {
                assert(spyCache.get.calledWith(testKey));
                assert(JSON.stringify(result) === objectJson);
                done();
            });
        });
    });
    describe('Expiring Needs', function () {
        it('Can put something in that will expire', function (done) {
            const testkey = 'session-key';
            const hash = { user:'username'};
            var spyCache = {
                hmset:function (key, value, cb) {
                    key.should.eql(testkey);
                    value.should.eql(hash);
                    if (cb) {
                        cb();
                    }
                },
                expire:function (key, ttl, cb) {
                    ttl.should.eql(10);
                    key.should.eql(testkey);
                    if (cb) {
                        cb();
                    }
                }
            };

            var cache = new Cache(spyCache);

            cache.storeSingleExpiringHash(testkey, hash, 10, function () {
                done();
            });
        });

        it('Can store an object with expiry', function (done) {
            var testKey = 'my-object-key';
            var theObject = {
                a: 3,
                b: {
                    x: 'string',
                    y: null,
                    z: 3.4
                }
            };
            var spyCache = {
                setex: sinon.stub().callsArg(3)
            };

            var cache = new Cache(spyCache);
            cache.storeExpiringObject(testKey, theObject, 20, function () {
                assert(spyCache.setex.calledWith(testKey, 20, JSON.stringify(theObject)));
                done();
            });
        });
    });
    describe('Removals', function () {
        it('Can remove a static hash by key', function (done) {
            const testkey = 'session-key';
            const hash = { user:'username'};
            var spyCache = {
                cache:{},
                hmset:function (key, value, cb) {
                    key.should.eql(testkey);
                    value.should.eql(hash);
                    this.cache[key] = value;
                    if (cb) {
                        cb();
                    }
                },
                del:function (key, cb) {
                    key.should.eql(testkey);
                    this.cache.should.have.property(key);
                    delete this.cache[key];
                    if (cb) {
                        cb();
                    }
                }
            };

            var cache = new Cache(spyCache);

            cache.storeSingleHash(testkey, hash, function () {
                cache.remove(testkey, function () {
                    spyCache.cache.should.not.have.property(testkey);
                    done();
                });
            });
        });
    });
});