var express = require('express');
var app = express();
var fs = require("fs");

var port = process.env.port || 1337

var bodyParser = require('body-parser')
app.use( bodyParser.json() );
app.use(bodyParser.urlencoded({
    extended: true
}));

app.get('/', function (req, res) {
    res.send('Hello World!');
});

app.post('/slackevent', function (req, res) {
    console.log( req.body );
    if(req.body.challenge) {
		res.type('json')
		res.send({"challenge": req.body.challenge});
	}
	else {
		
		if(req.body.event.file && req.body.event.file["initial_comment"]) {
			console.log("------ initial comment: ");
			console.log( req.body.event.file["initial_comment"]) );
		}
		
		res.send('done');
	}
})

var server = app.listen(port, function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log('Example app listening at http://%s:%s', host, port);
});