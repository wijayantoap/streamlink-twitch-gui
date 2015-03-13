define([
	"nwWindow",
	"ember",
	"utils/mkdirp",
	"utils/download",
	"utils/clearfolder"
], function(
	nwWindow,
	Ember,
	mkdirp,
	download,
	clearfolder
) {

	var PATH  = require( "path" ),
	    OS    = require( "os" ),
	    Notif = window.Notification,
	    get   = Ember.get,
	    set   = Ember.set;

	return Ember.Controller.extend({
		needs: [ "livestreamer" ],

		configBinding  : "metadata.package.config",
		retriesBinding : "config.notification-retries",
		intervalBinding: "config.notification-interval",

		// cache related properties
		cacheDir: function() {
			var dir = get( this, "config.notification-cache-dir" );
			return PATH.resolve( dir.replace( "{os-tmpdir}", OS.tmpdir() ) );
		}.property( "config.notification-cache-dir" ),
		cacheTime: function() {
			var days = get( this, "config.notification-cache-time" );
			return days * 24 * 3600 * 1000;
		}.property( "config.notification-cache-time" ),

		// use the app icon as group icon
		iconGroup: function() {
			return get( this, "config.tray-icon" ).replace( "{res}", 256 );
		}.property( "config.tray-icon" ),

		// controller state
		firstRun: true,
		model   : {},
		tries   : 0,

		_error  : false,
		error   : Ember.computed.and( "_error", "enabled" ),
		_next   : null,
		_running: Ember.computed.notEmpty( "_next" ),
		running : Ember.computed.and( "_running", "enabled" ),

		// automatically start polling once the user is logged in and has notifications enabled
		enabled: Ember.computed.and( "auth.isLoggedIn", "settings.notify_enabled" ),
		enabledObserver: function() {
			if ( get( this, "enabled" ) ) {
				this.start();
			} else {
				this.reset();
			}
		}.observes( "enabled" ).on( "init" ),


		/**
		 * Add a newly followed channel to the channel list cache
		 * so it doesn't pop up a new notification on the next query
		 */
		isFollowingChannelObserver: function() {
			if ( !get( this, "enabled" ) ) { return; }
			/** @type {Object} model */
			var model     = get( this, "model" );
			var following = get( this, "controllers.livestreamer.active.channel.following" );
			var name      = get( following, "channel.name" );
			if ( !following || !name || model.hasOwnProperty( name ) ) { return; }
			model[ name ] = new Date();
		}.observes( "controllers.livestreamer.active.channel.following" ),


		reset: function() {
			Ember.run.cancel( get( this, "_next" ) );

			this.setProperties({
				firstRun: true,
				model   : {},
				tries   : 0,
				_error  : false,
				_next   : null
			});
		},

		start: function() {
			this.reset();

			// collect garbage once at the beginning
			this.gc_icons()
				// then start
				.then( this.check.bind( this ) );
		},

		check: function() {
			if ( !get( this, "enabled" ) ) { return; }

			this.store.find( "twitchStreamsFollowed", {
				limit: 100
			})
				.then( this.queryCallback.bind( this ) )
				.then(function( newStreams ) {
					// show notifications
					if ( newStreams && newStreams.length ) {
						return this.prepareNotifications( newStreams );
					}
				}.bind( this ) )
				.then(function() {
					// query again in X milliseconds
					var interval = get( this, "interval" ) || 60000,
					    next     = Ember.run.later( this, this.check, interval );
					set( this, "_next", next );
					set( this, "tries", 0 );
				}.bind( this ) )
				// reset the controller in case of an error
				.catch(function() {
					var tries = get( this, "tries" ),
					    max   = get( this, "retries" );
					if ( ++tries > max ) {
						// we've reached the retry limit
						this.reset();
						set( this, "_error", true );
					} else {
						// immediately retry (with a slight delay)
						var next = Ember.run.later( this, this.check, 1000 );
						set( this, "_next", next );
						set( this, "tries", tries );
					}
				}.bind( this ) );
		},

		queryCallback: function( streams ) {
			/** @type {Object} model */
			var model, newStreams;

			// just fill the cache on the first run
			if ( !get( this, "firstRun" ) ) {
				// get a list of all new streams by comparing the cached streams
				model = get( this, "model" );
				newStreams = streams.filter(function( stream ) {
					var name  = get( stream, "channel.name" ),
					    since = get( stream, "created_at" );
					return name && ( !model.hasOwnProperty( name ) || model[ name ] < since );
				});
			}
			set( this, "firstRun", false );

			// update cache
			model = streams.reduce(function( obj, stream ) {
				obj[ get( stream, "channel.name" ) ] = get( stream, "created_at" );
				return obj;
			}, {} );
			set( this, "model", model );

			return newStreams;
		},


		prepareNotifications: function( streams ) {
			// merge multiple notifications and show a single one
			if ( streams.length > 1 && get( this.settings, "notify_grouping" ) ) {
				return this.showNotificationGroup( streams );

			// show all notifications
			} else {
				// download all channel icons first and save them into a local temp dir...
				return mkdirp( get( this, "cacheDir" ) )
					.then(function( iconTempDir ) {
						return Promise.all( streams.map(function( stream ) {
							var logo = get( stream, "channel.logo" );
							return download( logo, iconTempDir )
								.then(function( file ) {
									// the channel logo is now the local file
									set( stream, "logo", file );
									return stream;
								});
						}) );
					})
					.then(function( streams ) {
						streams.forEach( this.showNotificationSingle, this );
					}.bind( this ) );
			}
		},

		showNotificationGroup: function( streams ) {
			this.showNotification({
				icon : get( this, "groupIcon" ),
				title: "Some of your favorites have started streaming",
				body : streams.map(function( stream ) {
					return get( stream, "channel.display_name" );
				}).join( ", " ),
				click: function() {
					var settings = get( this, "settings.notify_click_group" );
					streams.forEach( this.notificationClick.bind( this, settings ) );
				}.bind( this )
			});
		},

		showNotificationSingle: function( stream ) {
			this.showNotification({
				icon : get( stream, "channel.logo" ),
				title: "%@ has started streaming".fmt( get( stream, "channel.display_name" ) ),
				body : get( stream, "channel.status" ) || "",
				click: function() {
					var settings = get( this, "settings.notify_click" );
					this.notificationClick( settings, stream );
				}.bind( this )
			});
		},

		notificationClick: function( settings, stream ) {
			// always restore the window
			if ( settings !== 0 ) {
				nwWindow.toggleMinimize( true );
				nwWindow.toggleVisibility( true );
			}

			switch( settings ) {
				case 1:
					this.send( "goto", "user.following" );
					break;
				case 2:
					this.send( "openLivestreamer", stream );
					break;
				case 3:
					var url = get( this, "config.twitch-chat-url" )
						.replace( "{channel}", get( stream, "name" ) );
					this.send( "openLivestreamer", stream );
					this.send( "openBrowser", url );
			}
		},

		showNotification: function( obj ) {
			var notify = new Notif( obj.title, {
				icon: obj.icon,
				body: obj.body
			});
			if ( obj.click ) {
				notify.addEventListener( "click", function() {
					this.close();
					obj.click();
				}, false );
			}
		},


		gc_icons: function() {
			var cacheDir  = get( this, "cacheDir" ),
			    cacheTime = get( this, "cacheTime" );

			return clearfolder( cacheDir, cacheTime )
				// always resolve
				.catch(function() {});
		}
	});

});
