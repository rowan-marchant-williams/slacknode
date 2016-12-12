var should = require('should');
var assert = require('assert');
var fs = require('fs');
var cheerio = require('cheerio');
var und = require('underscore');
var Filtering = require('../filtering');

describe('Filtering', function () {
    var dummyLogger;
    var dummyCache;
    var filtering;
    var basicUserPolicy;
    var dummyRequest;
    var dummyResponse;


    before(function (done) {
        dummyLogger = {
            log:function () {
            },
            logRequest:function () {
            }
        };

        dummyCache = {
            cache:{},
            retrieveJson:function (key, cb) {
                var that = this;
                process.nextTick(function() {
                    cb(null, that.cache[key]);
                });
            },
            storeJson:function (key, json) {
                this.cache[key] = json;
            },
            clear:function () {
                for (var key in this.cache) {
                    if (!this.cache.hasOwnProperty(key))
                        continue;
                    delete this.cache[key];
                }
            }
        };
        
        dummyRequest = {
            _sessionDetails: {
                username: 'marvin',
                tenantCode: 'TST'
            },
            url:'/secure/something'
        };
        dummyResponse = {
            writeHead:function (status, headers) {
                this.status = status;
                this.headers = headers;
            },
            send:function (content) {
                this._body = content;
            },
            end:function (content) {
                this._body = content;
            },
            json:function (content) {
                this._body = content;
            }
        };

        basicUserPolicy = {
            claims:[
                {
                    claimtype:'username',
                    typespec:'string',
                    value:'marvin',
                    subject:'marvin',
                    tenant:'TST'
                },
                {
                    claimtype:'role',
                    typespec:'string',
                    value:'tenant-user',
                    subject:'marvin',
                    tenant:'TST'
                }
            ]
        };

        var policyStoreOptions = {
            host:'192.168.0.113',
            port:4080,
            machine_name:'WIN_RJT5L6DKBU5'
        };

        filtering = new Filtering(policyStoreOptions, dummyCache, dummyLogger);

        done();
    });

    beforeEach(function (done) {
        dummyCache.clear();
        dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/users/marvin', JSON.stringify(basicUserPolicy));
        done();
    });

    describe('Filtering Templates', function () {

        it('non restricted template and no role claims should remain unaltered', function (done) {

            var rolePolicy = { };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms.html').toString();
            var $ = cheerio.load(sampleBody);

            dummyResponse._body = sampleBody;
            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                $.html().should.equal(html);
                done();
            });
        });

        it('non restricted template with role claims should remain unaltered', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms.html').toString();
            var $ = cheerio.load(sampleBody);

            dummyResponse._body = sampleBody;
            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                $.html().should.equal(html);
                done();
            });
        });

        it('tenant-admin restricted template with no matching role claims should have content stripped', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            dummyResponse._body = fs.readFileSync(__dirname + '/data/managealarms-with-tenant-admin-claims.html').toString();
            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                var $ = cheerio.load(html);
                // Check for content
                var buttons = $('.btn');
                buttons.length.should.equal(1);
                done();
            });
        });

        it('tenant-user restricted template with matching role claims should remain unaltered', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms-with-tenant-user-claims.html').toString();
            var $ = cheerio.load(sampleBody);

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = sampleBody;

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                $.html().should.equal(html);
                done();
            });
        });

        it('multirole restricted template with matching role claims first should remain unaltered', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms-with-multirole-first-claims.html').toString();
            var $ = cheerio.load(sampleBody);

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = sampleBody;

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                $.html().should.equal(html);
                done();
            });
        });

        it('multirole restricted template with matching role claims second should remain unaltered', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms-with-multirole-second-claims.html').toString();
            var $ = cheerio.load(sampleBody);

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-engineer', JSON.stringify(rolePolicy));

            dummyResponse._body = sampleBody;

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                $.html().should.equal(html);
                done();
            });
        });

        it('multirole restricted template with no matching role claims should have content stripped', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms-with-multirole-no-claims.html').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = sampleBody;

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                var $ = cheerio.load(html);
                // Check for content
                var buttons = $('.btn');
                buttons.length.should.equal(1);
                done();
            });
        });

        it('tenant-admin restricted template with no matching role claims should have all relevant content stripped', function (done) {

            var rolePolicy = {
                claims:[
                    {
                        claimtype:'role',
                        typespec:'string',
                        value:'tenant-user',
                        subject:'tenant-user',
                        tenant:'TST'
                    },
                    {
                        claimtype:'resource',
                        typespec:'uri',
                        value:'/.*',
                        subject:'tenant-user',
                        tenant:'TST',
                        action:'GET'
                    }
                ]
            };

            var sampleBody = fs.readFileSync(__dirname + '/data/managealarms-with-tenant-admin-many-claims.html').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/users/marvin', JSON.stringify(basicUserPolicy));
            dummyCache.storeJson('accesscontrol/securitypolicies/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = sampleBody;

            filtering.filterClaims(dummyRequest, dummyResponse, function () {
                var html = dummyResponse._body;
                var $ = cheerio.load(html);
                // Check for content
                var checkboxes = $('input[type=checkbox]');
                checkboxes.length.should.equal(0); // There are 6 to begin with
                done();
            });
        });
    });

    describe('Filtering Data Models and Views', function () {
        var rolePolicy = {
            claims:[
                {
                    claimtype:'role',
                    typespec:'string',
                    value:'tenant-user',
                    subject:'tenant-user',
                    tenant:'TST'
                },
                {
                    claimtype:'resource',
                    typespec:'uri',
                    value:'/.*',
                    subject:'tenant-user',
                    tenant:'TST',
                    action:'GET'
                }
            ]
        };


        it('no user filters and empty role policy should remain unaltered', function (done) {
            var rolePolicy = { };

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            var expected = JSON.parse(sampleDataModel);
            dummyResponse._body = expected;

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                expected.should.eql(result);
                done();
            });
        });

        it('no user or role filters should remain unaltered', function (done) {

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            var expected = JSON.parse(sampleDataModel);
            dummyResponse._body = expected;

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                expected.should.eql(result);
                done();
            });
        });

        it('no user but single role filter should strip top-level data item', function (done) {
            rolePolicy.filters = [
                { path:'/locationReference'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                result.should.not.have.property('locationReference');
                done();
            });
        });

        it('no user but single role filter should strip top-level data array', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                result.should.not.have.property('dialUpEntries');
                done();
            });
        });

        it('no user but single role filter should strip data array elements', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries/*[/start >= 0]'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                result.dialUpEntries.length.should.eql(0);
                done();
            });
        });

        it('no user but single role filter should strip data array element properties', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries/*[/start >= 0]', key:'start'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                und.each(result.dialUpEntries, function (entry) {
                    entry.should.not.have.property('start');
                });
                done();
            });
        });

        it('no user but single role filter should strip data array element with property', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries/*[/repeat >=0]'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                und.each(result.dialUpEntries, function (entry) {
                    entry.should.not.have.property('repeat');
                });
                done();
            });
        });

        it('no user but two role filters should strip data array elements properties', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries/*[/start >= 0]', key:'start'},
                {path:'/dialUpEntries/*[/repeat >=0]', key:'repeat'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                und.each(result.dialUpEntries, function (entry) {
                    entry.should.not.have.property('start');
                    entry.should.not.have.property('repeat');
                });
                done();
            });
        });

        it('no user but two role filters should strip data array elements with properties', function (done) {
            rolePolicy.filters = [
                {path:'/dialUpEntries/*[/start >= 0]'},
                {path:'/dialUpEntries/*[/repeat >=0]'}
            ];

            var sampleDataModel = fs.readFileSync(__dirname + '/data/edit-dialup.json').toString();

            dummyCache.storeJson('accesscontrol/securitypolicies/tenant/TST/roles/tenant-user', JSON.stringify(rolePolicy));

            dummyResponse._body = JSON.parse(sampleDataModel);

            filtering.filterDataModel(dummyRequest, dummyResponse, function () {
                var result = dummyResponse._body;
                result.dialUpEntries.length.should.eql(0);
                done();
            });
        });
    });
});