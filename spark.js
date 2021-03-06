/*
Name:          spark.js
Description:   Read and control Spark Cores with node.js
Author:        Franklin van de Meent (https://frankl.in)
Feedback:      https://github.com/fvdm/nodejs-spark/issues
Source:        https://github.com/fvdm/nodejs-spark
Service:       Spark (https://www.spark.io)
License:       Unlicense (Public Domain)
               https://github.com/fvdm/nodejs-spark/blob/master/LICENSE
*/

var http = require('https').request
var querystring = require('querystring')

// Default settings
var app = {
	timeout: 10000
}

// Security details must not be public
var auth = {
	username: null,
	password: null,
	access_token: null,
	access_token_expires: null
}

// List devices
app.devices = function( cb ) {
	talk({ path: 'devices', callback: cb })
}

// One device
app.device = function( device ) {
	return {
		info: function( cb ) {
			talk({ path: 'devices/'+ device, callback: cb })
		},
		
		variable: function( variable, cb ) {
			talk({ path: 'devices/'+ device +'/'+ variable, callback: cb })
		},
		
		func: function( func, arg, cb ) {
			if( typeof arg === 'function' ) {
				var cb = arg
				var vars = null
			} else if( typeof arg === 'string' || typeof arg === 'numeric' ) {
				var vars = {args: arg}
			}
			
			talk({
				method: 'POST',
				path: 'devices/'+ device +'/'+ func,
				body: vars,
				callback: cb
			})
		}
	}
}

// List or generate access_token
app.accessToken = {}

app.accessToken.list = function( callback ) {
	talk({
		path: 'access_token',
		auth: true,
		callback: callback
	})
}

app.accessToken.generate = function( cb ) {
	if( auth.username && auth.password ) {
		var vars = {
			grant_type: 'password',
			username: auth.username,
			password: auth.password
		}
		talk({
			method: 'POST',
			path: 'oauth/token',
			body: vars,
			auth: true,
			callback: cb
		})
	} else {
		cb( new Error('no credentials') )
	}
}

app.accessToken.delete = function( token, cb ) {
	talk({
		method: 'DELETE',
		path: 'access_tokens/'+ token,
		auth: true,
		callback: cb
	})
}

// Communicate
// method      GET POST PUT DELETE    GET
// path        method path            /
// query       query fields           {}
// body        body fields or data
// callback    function( err, data )
// auth        use username:password  [from module setup]
// contentType change Content-Type    !GET: application/x-www-form-urlencoded
// userAgent   change User-Agent
// headers     custom headers         {}
// timeout     override timeout ms    10000

function talk( props ) {
	// prevent multiple callbacks
	var complete = false
	function doCallback( err, res ) {
		if( !complete ) {
			complete = true
			props.callback( err || null, res || null )
		}
	}
	
	// build request
	var options = {
		hostname: 'api.spark.io',
		path: '/v1/'+ props.path,
		method: props.method || 'GET',
		headers: {
			'User-Agent': props.userAgent || 'spark.js (https://github.com/fvdm/nodejs-spark)'
		}
	}
	
	// http basic auth
	if( props.auth && (!auth.username || !auth.password) ) {
		doCallback( new Error('no credentials') )
		return
	} else if( props.auth ) {
		options.auth = auth.username +':'+ auth.password
	} else {
		options.headers.Authorization = 'Bearer '+ auth.access_token
	}
	
	// stringify objects
	var body = props.body || null
	if( typeof body === 'object' ) {
		body = querystring.stringify( props.body )
	}
	
	if( typeof props.query === 'object' ) {
		options.path += '?'+ querystring.stringify( props.query )
	}
	
	// default POST headers
	if( props.method !== 'GET' && body ) {
		options.headers['Content-Type'] = props.contentType || 'application/x-www-form-urlencoded'
		options.headers['Content-Length'] = body.length
	}
	
	// override headers
	if( typeof props.headers === 'object' && Object.keys( props.headers ).length >= 1 ) {
		for( var key in props.headers ) {
			options.headers[ key ] = props.headers[ key ]
		}
	}
	
	// run
	var request = http( options )
	
	// set timeout
	request.on( 'socket', function( socket ) {
		socket.setTimeout( props.timeout || app.timeout )
		socket.on( 'timeout', function() {
			request.abort()
		})
	})
	
	// process response
	request.on( 'response', function( response ) {
		var data = ''
		
		response.on( 'data', function( ch ) {
			data += ch
		})
		
		// complete
		response.on( 'end', function() {
			data = data.trim()
			
			try {
				data = JSON.parse( data )
			} catch(e) {
				doCallback( new Error('api invalid') )
				return
			}
			
			if( response.statusCode !== 200 ) {
				var err = new Error('api error')
				err.code = data.code
				err.error = data.error
				err.error_description = data.error_description
				doCallback( err )
				return
			}
			
			if( data.return_value && data.return_value === -1 ) {
				doCallback( new Error('action failed'), data )
				return
			} else {
				doCallback( null, data )
			}
		})
		
		// dropped
		response.on( 'close', function() {
			doCallback( new Error('request dropped') )
		})
	})
	
	// fail
	request.on( 'error', function( error ) {
		if( error.code === 'ECONNRESET' ) {
			var err = new Error('request timeout')
		} else {
			var err = new Error('request failed')
		}
		err.error = error
		doCallback( err )
	})
	
	// do it all
	if( props.method !== 'GET' ) {
		request.end( body )
	} else {
		request.end()
	}
}

// export
// either ( 'access_token_string', [1000] )
// or ( {username: 'john', password: 'doe'}, [1000] )
module.exports = function( access_token, timeout ) {
	if( typeof access_token === 'object' ) {
		auth.username = access_token.username
		auth.password = access_token.password
		
		app.accessToken.generate( function( err, token ) {
			if( !err ) {
				auth.access_token = token.access_token
				auth.access_token_expires = token.expires_in
			}
		})
	} else {
		auth.access_token = access_token
	}
	
	app.timeout = timeout || app.timeout
	return app
}
