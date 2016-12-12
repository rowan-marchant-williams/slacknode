var _ = require('underscore');

var numberTypes = ['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed64', 'sfixed64', 'double', 'fixed32', 'sfixed32', 'float'];

module.exports = function convertToSchemaFormat (msg, fields) {
    var val;
    if (Array.isArray(msg)) {
        msg.forEach(function(entry, index) {
            msg[index] = convertToSchemaFormat(entry, fields);
        });
    } else {
        _.each(Object.keys(msg), function(key) {
            var field = _.where(fields, {name: key})[0];

            if (!field) {
                delete msg[key];
                return;
            }

            if (typeof msg[key] == 'object') {
                if (field.resolvedType) {
                    msg[key] = convertToSchemaFormat(msg[key], field.resolvedType._fields);
                }
            } else {
                if (_.contains(numberTypes, field.type.name)) {
                    val = Number(msg[key]);
                    msg[key] = val;
                }
            }
        });
    }
    return msg;
};