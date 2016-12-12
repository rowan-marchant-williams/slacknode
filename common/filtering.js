'use strict';

var util = require('util');
var cheerio = require('cheerio');
var SpahQl = require('spahql');
var und = require('underscore');
var async = require('async');
var restify = require('restify');
var ejs = require('elastic.js');
var nc = require('elastic.js/elastic-node-client');
var helpers = require(__dirname + '/utils/helpers.js');
var config = require('konphyg')(__dirname + '/config');
var url = require('url');

function Filtering(policyStoreOptions, cache, logger) {

    var SOURCE = 'Filtering Content';
    var SEARCH_INDEX_FORMAT = '%s_access_control';
    var USERNAME_CLAIM_QUERY = "/claims/*[/claimtype == 'username']";
    var ROLE_CLAIM_QUERY = "/claims/*[/claimtype == 'role']";
    var ROLE_POLICY_CACHE_KEY_FORMAT = 'accesscontrol/securitypolicies/tenant/%s/roles/%s';
    var USER_POLICY_CACHE_KEY_FORMAT = 'accesscontrol/securitypolicies/tenant/%s/users/%s';
    var ROLE_POLICY_DOCUMENT_KEY_FORMAT = '%s_%s';
    var USER_POLICY_DOCUMENT_KEY_FORMAT = '%s_%s';
    var FilterQuery = '/filters';

    var _logger = logger;
    var _cache = cache;
    var _opts = policyStoreOptions;

    var _makeAuthorizationRequest = function (req) {
        var includeQueryString = true;
        var uri = url.parse(req.url, includeQueryString);

        return {
            claims: [
                {
                    claimtype: 'resource',
                    typespec: 'string',
                    value: uri.pathname,
                    subject: req._sessionDetails.username || 'anonymous',
                    tenant: req._sessionDetails.tenantCode || 'anonymous',
                    action: req.method
                }
            ]
        };
    };

    var _retrievePolicyFromElasticSearch = function (policyKey, authorizationRequest, cb) {

        // Go long way round to ElasticSearch to get Policy document
        var policyIndex = util.format(SEARCH_INDEX_FORMAT, _opts.machine_name.toLowerCase());
        var _searchResultsSuccessful = function (results) {
            if (results.hits && 1 === results.hits.hits.length) {
                var policy = results.hits.hits[0]._source; // Bizarre API!
                if (cb && 'function' === typeof cb) {
                    // Callback asynchronously to keep expected pattern
                    process.nextTick(cb.bind(null, policy));
                }
            }
        };

        var _searchResultsFailed = function (err) {
            var logMessage = util.format('%s:Failed to get Policy from ElasticSearch', SOURCE);
            _logger.log('info', logMessage, err);
        };

        ejs.client = nc.NodeClient(_opts.host, _opts.port);
        var idQuery = ejs.IdsQuery(policyKey);
        var tenantTermQuery = ejs.TermQuery('tenant', authorizationRequest.claims[0].tenant.toLowerCase());
        var policyQuery = ejs.BoolQuery().must(idQuery).must(tenantTermQuery);
        var searchRequest = ejs.Request();
        var policyRequest = searchRequest.indices(policyIndex).types('policy').query(policyQuery);
        policyRequest.doSearch(_searchResultsSuccessful, _searchResultsFailed);
    };

    var claimIsForCorrectUser = function (_tenant, _username, usernameClaim) {
        return _tenant === usernameClaim.tenant && _username === usernameClaim.subject;
    };

    var logCacheReadMissing = function (lookupType, _username, err) {
        var msg = util.format('%s - %s Policy for %j missing from cache',
            SOURCE, lookupType, _username);
        _logger.log('info', msg, err);
    };

    var _makeDocParseable = function (stringIn) {
        var stringOut = stringIn.replace(/<script/g, '<script-tag-placeholder');
        stringOut = stringOut.replace(/<\/script/g, '</script-tag-placeholder');
        return stringOut;
    };

    var _fixDocForSending = function (stringIn) {

        var stringOut = stringIn.replace(/<script-tag-placeholder/g, '<script');
        stringOut = stringOut.replace(/<\/script-tag-placeholder/g, '</script');
        return stringOut;
    };

    var _filterClaims = function (req, res, next) {

        var unfilteredBody = res._body;
        var includeQueryString = true;

        var _username = req._sessionDetails.username;
        var _tenant = req._sessionDetails.tenantCode;
        var _userPolicyCacheKey = util.format(USER_POLICY_CACHE_KEY_FORMAT, _tenant, _username);
        var _userPolicyDocumentKey = util.format(USER_POLICY_DOCUMENT_KEY_FORMAT, _tenant, _username);

        var authorizationRequest = _makeAuthorizationRequest(req);

        // Try interception claims filtering
        var serverDom = cheerio.load(_makeDocParseable(unfilteredBody));

        var claimsCounter = 0;
        var allClaimsDone = [];
        // enumerate the claims to be processed so we know when they're all finished
        serverDom('[data-claim-types]').each(function () {
            allClaimsDone[claimsCounter] = false;
            claimsCounter = claimsCounter + 1;
        });

        var _sendFinalParsedDoc = function () {
            var filteredBody = _fixDocForSending(serverDom.html());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(filteredBody);
            return next();
        };

        // Send doc straight back if there are no claims to check
        if (0 === claimsCounter) {
            _sendFinalParsedDoc();
        }

        // check to see whether ALL sections of the doc have been checked for valid claims
        var _trySendingFinalDoc = function () {
            if (!allClaimsDone.some(function (state) {
                    return state === false;
                })) {
                _sendFinalParsedDoc();
            }
        };

        var _validateDataClaim = function (userPolicy, element, eleIndex) {

            var claimDenied = true;  // Defensive move

            var claimTypes = serverDom(element).attr('data-claim-types').split(',');
            var claimValues = serverDom(element).attr('data-claim-values').split(',');

            if (claimTypes.length !== claimValues.length) {
                // Bail out
                return;
            }

            var _finalCallback = function () {
                var processMode = 'server';
                var firstElement = serverDom(element).first();
                if (undefined !== firstElement.attr('data-claim-mode')) {
                    processMode = firstElement.attr('data-claim-mode');
                }
                if (true === claimDenied) {
                    if (processMode === 'server') {
                        serverDom(element).remove();
                        // early exit!
                        allClaimsDone[eleIndex] = true;
                        _trySendingFinalDoc();
                        return;
                    } else {
                        firstElement.attr('data-claim-action','denied');
                    }
                } else {
                    firstElement.attr('data-claim-action','permitted');
                }

                firstElement.removeAttr('data-claim-types','');
                firstElement.removeAttr('data-claim-values','');

                allClaimsDone[eleIndex] = true;
                _trySendingFinalDoc();
            };

            var _checkUserPolicy = function (userPolicy) {

                var userPolicyDb;
                var usernameClaims;

                var _checkRoleClaim = function (policyClaim) {

                    var policyClaim = policyClaim.value;
                    var regexp = new RegExp(policyClaim.value);

                    if (claimTypes.length > 0) {
                        for (var index = claimTypes.length; index--;) {
                            if (regexp.test(claimValues[index])) {
                                // Does the Tenant agree?
                                return _tenant === policyClaim.tenant;
                            }
                        }
                        return false;
                    }
                };

                var _extractAndCheckRoleClaims = function () {

                    var usernameClaim = usernameClaims[0].value;
                    var correctUser = claimIsForCorrectUser(_tenant, _username, usernameClaim);

                    if (!correctUser) {
                        // Bail out and strip element
                        claimDenied = claimDenied && true;
                        return;
                    }

                    var roleClaims = userPolicyDb.select(ROLE_CLAIM_QUERY);
                    if (roleClaims && roleClaims instanceof Array && roleClaims.length > 0) {

                        var anyClaims = roleClaims.some(_checkRoleClaim);
                        claimDenied = claimDenied && !anyClaims;
                    } else {
                        claimDenied = claimDenied && true;
                    }
                };

                if (userPolicy) {
                    // Check user policy is for the correct User and Tenant
                    userPolicyDb = SpahQl.db(userPolicy);
                    usernameClaims = userPolicyDb.select(USERNAME_CLAIM_QUERY);

                    if (usernameClaims && usernameClaims instanceof Array && 1 === usernameClaims.length) {
                        _extractAndCheckRoleClaims();
                    } else {
                        claimDenied = claimDenied && true;
                    }
                } else {
                    claimDenied = claimDenied && true;
                }

                _finalCallback();
            };

            _checkUserPolicy(userPolicy);

        };

        var _validateDataClaims = function(userPolicy) {
            serverDom('[data-claim-types]').each(function (eleIndex, element) {
                _validateDataClaim(userPolicy, element, eleIndex);
            });
        };

        var _userPolicyRetrievedFromElasticSearch = function (userPolicy) {
            if (userPolicy) {
                // Add Policy to cache
                _cache.storeJson(_userPolicyCacheKey, JSON.stringify(userPolicy));
            }
            _validateDataClaims(userPolicy);
        };

        var _userPolicyRetrievedFromCache = function (err, userPolicyDocument) {
            var userPolicy;
            if (err || !userPolicyDocument) {
                logCacheReadMissing('User', _username, err);
                _retrievePolicyFromElasticSearch(_userPolicyDocumentKey, authorizationRequest, _userPolicyRetrievedFromElasticSearch);
            } else {
                userPolicy = JSON.parse(userPolicyDocument);
                _validateDataClaims(userPolicy);
            }
        };

        _cache.retrieveJson(_userPolicyCacheKey, _userPolicyRetrievedFromCache);
    };

    var _filterJson = function (req, res, next) {

        var unfilteredBody = res._body;

        // Non-Secure URL's need not be Filtered
        if (-1 === req.url.indexOf('/secure/')) {
            // res.json does not work if content type is already set to application/json
            res.contentType = undefined;
            res.json(unfilteredBody);
            return next();
        }

        // Use Filters in the Policies to pick out data to strip
        var bodyDb = SpahQl.db(unfilteredBody);
        var _username = req._sessionDetails.username;
        var _tenant = req._sessionDetails.tenantCode;
        var _userPolicyCacheKey = util.format(USER_POLICY_CACHE_KEY_FORMAT, _tenant, _username);
        var _userPolicyDocumentKey = util.format(USER_POLICY_DOCUMENT_KEY_FORMAT, _tenant, _username);
        var _rolePolicyCacheKey;
        var _rolePolicyDocumentKey;

        var authorizationRequest = _makeAuthorizationRequest(req);

        function doAsynchronousWork(callback) {

            // Here's where the work happens and we call completed when it's done
            var userPolicyDb;
            var userCallback;
            var roleCallback;

            var _arrayObjectHasOnlyOneElement = function (object) {
                return object && object instanceof Array && object.length === 1;
            };

            var _filterFromUserPolicy = function (userPolicy) {

                if (!userPolicy) {
                    userCallback(null, false);
                } else {
                    // Check user policy is for the correct User and Tenant
                    userPolicyDb = SpahQl.db(userPolicy);
                    var usernameClaims = userPolicyDb.select(USERNAME_CLAIM_QUERY);

                    if (!_arrayObjectHasOnlyOneElement(usernameClaims)) {
                        userCallback(null, false);
                    } else {
                        var usernameClaim = usernameClaims[0].value;
                        var correctUser = claimIsForCorrectUser(_tenant, _username, usernameClaim);

                        if (!correctUser) {
                            userCallback(null, false);
                        } else {
                            // Apply any user Policy filters
                            var userFilters = userPolicyDb.select(FilterQuery);
                            if (!(userFilters && userFilters instanceof Array && userFilters.length > 0)) {
                                userCallback(null, true);
                            } else {
                                var outerDone = und.after(userFilters.length, function () {
                                    userCallback(null, true); // OK not to have any filters
                                });
                                und.each(userFilters, function (filters) {
                                    // Apply filters by stripping out anything found at filter
                                    var innerDone = und.after(filters.value.length, function () {
                                        outerDone();
                                    });
                                    und.each(filters.value, function (filter) {
                                        var select = bodyDb.select(filter.path);
                                        select.destroyAll(filter.key);
                                        innerDone();
                                    });
                                });
                            }
                        }
                    }
                }
            };

            var _userPolicyRetrievedFromCache = function (err, userPolicyDocument) {
                var userPolicy;
                if (!(err || !userPolicyDocument)) {
                    userPolicy = JSON.parse(userPolicyDocument);
                    _filterFromUserPolicy(userPolicy);
                } else {
                    logCacheReadMissing('User', _username, err);

                    _retrievePolicyFromElasticSearch(_userPolicyDocumentKey, authorizationRequest, function (userPolicy) {
                        if (!userPolicy) {
                            userCallback(null, false);
                        } else {
                            // Add Policy to cache
                            _cache.storeJson(_userPolicyCacheKey, JSON.stringify(userPolicy));
                            _filterFromUserPolicy(userPolicy);
                        }
                    });
                }
            };


            var _filterUserPolicy = function (cb) {
                userCallback = cb;
                _cache.retrieveJson(_userPolicyCacheKey, _userPolicyRetrievedFromCache);
            };


            var _filterFromRolePolicy = function (rolePolicy) {

                if (!rolePolicy) {
                    roleCallback(null, false);
                } else {

                    var rolePolicyDb = SpahQl.db(rolePolicy);

                    // Apply any Role Policy filters
                    var roleFilters = rolePolicyDb.select(FilterQuery);
                    if (!(roleFilters && roleFilters instanceof Array && roleFilters.length > 0)) {
                        roleCallback(null, true); // OK not to have any filters
                    } else {
                        var outerDone = und.after(roleFilters.length, function () {
                            roleCallback(null, true);
                        });
                        und.each(roleFilters, function (filters) {
                            // Apply filters by stripping out anything found at filter
                            var innerDone = und.after(filters.value.length, function () {
                                outerDone();
                            });
                            und.each(filters.value, function (filter) {
                                var select = bodyDb.select(filter.path);
                                select.destroyAll(filter.key);
                                innerDone();
                            });
                        });
                    }
                }
            };


            var _rolePolicyRetrievedFromCache = function (err, rolePolicyDocument) {
                var rolePolicy;
                if (!(err || !rolePolicyDocument)) {
                    rolePolicy = JSON.parse(rolePolicyDocument);
                    _filterFromRolePolicy(rolePolicy);
                } else {
                    logCacheReadMissing('Role', _username, err);

                    _retrievePolicyFromElasticSearch(_rolePolicyDocumentKey, authorizationRequest, function (rolePolicy) {
                        if (rolePolicy) {
                            // Add Policy to cache
                            _cache.storeJson(_rolePolicyCacheKey, JSON.stringify(rolePolicy));
                        }
                        _filterFromRolePolicy(rolePolicy);
                    });
                }
            };


            var _filterRolePolicy = function (cb) {
                roleCallback = cb;
                if (!userPolicyDb) {
                    roleCallback(null, false);
                } else {
                    var roleClaims = userPolicyDb.select(ROLE_CLAIM_QUERY);
                    if (!_arrayObjectHasOnlyOneElement(roleClaims)) {
                        roleCallback(null, false);
                    } else {
                        var roleClaim = roleClaims[0].value;
                        _rolePolicyCacheKey = util.format(ROLE_POLICY_CACHE_KEY_FORMAT, roleClaim.tenant, roleClaim.value);
                        _rolePolicyDocumentKey = util.format(ROLE_POLICY_DOCUMENT_KEY_FORMAT, roleClaim.tenant, roleClaim.value);
                        _cache.retrieveJson(_rolePolicyCacheKey, _rolePolicyRetrievedFromCache);
                    }
                }
            };


            var _completed = function () {
                return function (err, results) {
                    if (err) {
                        callback(err);
                    }
                    // Results should have both parts finished and at least one of them true
                    if (results.user || results.role) {
                        callback(unfilteredBody);
                    } else {
                        callback(new restify.NotAuthorizedError());
                    }
                };
            };

            var seriesSteps = {
                user: _filterUserPolicy,
                role: _filterRolePolicy
            };

            async.series(seriesSteps, _completed());
        }

        doAsynchronousWork(function (result) {
            if (result instanceof Error) {
                return next(result);
            }
            res.contentType = undefined;
            res.json(result);
            return next();
        });
    };

    var _filterBrand = function(req, res, next) {

        var $ = cheerio.load(res._body);
        var brandedSections = $('[data-brand-group]');

        if (brandedSections.length) {
            var groupedBrandedSections = {};

            // Group branded sections
            brandedSections.each(function(i, elem) {
                var $elem = $(elem);
                var brandGroup = $elem.attr('data-brand-group');

                if (! groupedBrandedSections.hasOwnProperty(brandGroup)) {
                    groupedBrandedSections[brandGroup] = [];
                }
                groupedBrandedSections[brandGroup].push($elem.attr('data-brand-name'));
            });

            // Select one variation from the brand group
            und.each(groupedBrandedSections, function(value, key) {
                $('[data-brand-group="' + key + '"]:not([data-brand-name="' + req._brand + '"])').remove();
            });
        }

        res._body = $.html();

        return next();
    };

    var _bypass = function (req, res, next) {
        // Not sure what we can do to filter JavaScript code
        return next();
    };

    // Public API
    return {
        filterClaims: _filterClaims,
        filterDataModel: _filterJson,
        filterViewModel: _bypass,
        filterView: _filterJson,
        filterBrand: _filterBrand
    };
}

module.exports = Filtering;
