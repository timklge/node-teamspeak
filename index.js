/*
 * ----------------------------------------------------------------------------
 * "THE BEER-WARE LICENSE" (Revision 42):
 * <timklge@wh2.tu-dresden.de> wrote this file. As long as you retain this notice you
 * can do whatever you want with this stuff. If we meet some day, and you think
 * this stuff is worth it, you can buy me a beer in return - Tim Kluge
 * ----------------------------------------------------------------------------
 */

var net =             require("net"),
	LineInputStream = require("line-input-stream"),
	events =          require("events"),
	util =            require("util");

function TeamSpeakClient(host, port){
	events.EventEmitter.call(this);

	var self =      this,
		socket =    net.connect(port || 10011, host || 'localhost'),
		reader =    null,
		status =    -2,
		queue =     [],
		executing = null;
	
	function tsescape(s){
		var r = String(s);
		r = r.replace(/\\/g, "\\\\");   // Backslash
		r = r.replace(/\//g, "\\/");    // Slash
		r = r.replace(/\|/g, "\\p");    // Pipe
		r = r.replace(/\n/g, "\\n");    // Newline
		r = r.replace(/\r/g, "\\r");    // Carriage Return
		r = r.replace(/\t/g, "\\t");    // Tab
		r = r.replace(/\v/g, "\\v");    // Vertical Tab
		r = r.replace(/ /g, "\\s");     // Whitespace
		return r;
	}
	
	function tsunescape(s){
		var r = s.replace(/\\s/g, " ");	// Whitespace
		r = r.replace(/\\p/g, "|");     // Pipe
		r = r.replace(/\\n/g, "\n");    // Newline
		r = r.replace(/\\r/g, "\r");    // Carriage Return
		r = r.replace(/\\t/g, "\t");    // Tabu
		r = r.replace(/\\v/g, "\v");    // Vertical Tab
		r = r.replace(/\\\//g, "\/");   // Slash
		r = r.replace(/\\\\/g, "\\");   // Backslash
		return r;
	}
	
	function checkQueue(){
		if(!executing && queue.length >= 1){
			executing = queue.shift();
			socket.write(executing.text + "\n");
		}
	}
	
	function parseResponse(s){
		var response = [];
		var records = s.split("|");
		
		response = records.map(function(k){
			var args = k.split(" ");
			var thisrec = {};
			args.forEach(function(v){
				var key = tsunescape(v.substr(0, v.indexOf("=")));
				var value = tsunescape(v.substr(v.indexOf("=")+1));
				if(parseInt(value, 10) == value) value = parseInt(value, 10);
				thisrec[key] = value;
			});
			return thisrec;
		});
		
		if(response.length === 0){
			response = null;
		} else if(response.length === 1){
			response = response.shift();
		}
		
		return response;
	}
	
	// Return pending commands that are going to be sent to the server.
	// Note that they have been parsed - Access getPending()[0].text to get
	// the full text representation of the command.
	TeamSpeakClient.prototype.getPending = function(){
		return queue.slice(0);
	};
	
	// Clear the queue of pending commands so that any command that is currently queued won't be executed.
	// The old queue is returned.
	TeamSpeakClient.prototype.clearPending = function(){
		var q = queue;
		queue = [];
		return q;
	};
	
	// Send a command to the server
	TeamSpeakClient.prototype.send = function(){
		var args = Array.prototype.slice.call(arguments);
		var options = [], params = {};
		var callback = undefined;
		var cmd = args.shift();
		args.forEach(function(v){
			if(util.isArray(v)){
				options = v;
			} else if(typeof v === "function"){
				callback = v;
			} else {
				params = v;
			}
		});
		var tosend = tsescape(cmd);
		options.forEach(function(v){
			tosend += " -" + tsescape(v);
		});
		for(var k in params){
			var v = params[k];
			if(util.isArray(v)){ // Multiple values for the same key - concatenate all
				var doptions = v.map(function(val){
					return tsescape(k) + "=" + tsescape(val); 
				});
				tosend += " " + doptions.join("|");
			} else {
				tosend += " " + tsescape(k.toString()) + "=" + tsescape(v.toString());
			}
		}
		queue.push({cmd: cmd, options: options, parameters: params, text: tosend, cb: callback});
		if(status === 0) checkQueue();
	};
	
	socket.on("error", function(err){
		self.emit("error", err);
	});
	
	socket.on("close", function(){
		self.emit("close", queue);
	});
	
	socket.on("connect", function(){
		reader = LineInputStream(socket);
		reader.on("line", function(line){
			var s = line.trim();
			// Ignore two first lines sent by server ("TS3" and information message) 
			if(status < 0){
				status++;
				if(status === 0) checkQueue();
				return;
			}
			// Server answers with:
			// [- One line containing the answer ]
			// - "error id=XX msg=YY". ID is zero if command was executed successfully.
			var response = undefined;
			if(s.indexOf("error") === 0){
				response = parseResponse(s.substr("error ".length).trim());
				executing.error = response;
				if(executing.error.id === "0") delete executing.error;
				if(executing.cb) executing.cb.call(executing, executing.error, executing.response,
					executing.rawResponse);
				executing = null;
				checkQueue();
			} else if(s.indexOf("notify") === 0){
				s = s.substr("notify".length);
				response = parseResponse(s);
				self.emit(s.substr(0, s.indexOf(" ")), response);
			} else if(executing) {
				response = parseResponse(s); 
				executing.rawResponse = s;
				executing.response = response;
			}
		});
		self.emit("connect");
	}); 
}

util.inherits(TeamSpeakClient, events.EventEmitter);
module.exports = TeamSpeakClient;
