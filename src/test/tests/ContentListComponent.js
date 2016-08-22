import QUnit from "QUnit";
import Testutils from "Testutils";
import Ember from "Ember";
import ContentListComponent from "components/list/ContentListComponent";
import IsGteHelper from "helpers/IsGteHelper";
import HasOwnPropertyHelper from "helpers/HasOwnPropertyHelper";


var runAppend = Testutils.runAppend;
var runDestroy = Testutils.runDestroy;
var cleanOutput = Testutils.cleanOutput;
var buildOwner = Testutils.buildOwner;

var setOwner = Ember.setOwner;
var run = Ember.run;
var Component = Ember.Component;
var compile = Ember.HTMLBars.compile;

var owner, component;


QUnit.module( "ContentListComponent", {
	"setup": function() {
		owner = buildOwner();
		owner.register( "component:content-list", ContentListComponent );
		owner.register( "component:infinite-scroll", Ember.Component.extend({}) );
		owner.register( "helper:is-gte", IsGteHelper );
		owner.register( "helper:has-own-property", HasOwnPropertyHelper );
	},

	"teardown": function() {
		runDestroy( component );
		runDestroy( owner );
		owner = component = null;
	}
});


QUnit.test( "Empty content", function( assert ) {

	var content = [];
	var layout = compile(
		"{{#content-list content=content as |i|}}{{i}}{{else}}empty{{/content-list}}"
	);
	component = Component.extend({ content, layout }).create();
	setOwner( component, owner );

	runAppend( component );
	assert.equal( cleanOutput( component ), "empty", "Empty content" );

	run( content, "pushObject", 1 );
	assert.equal( cleanOutput( component ), "1", "Non empty content" );

});


QUnit.test( "New items", function( assert ) {

	var content = [ 1, 2 ];
	var layout = compile(
		"{{#content-list content=content as |i n|}}{{n}}{{/content-list}}"
	);
	component = Component.extend({ content, layout }).create();
	setOwner( component, owner );

	runAppend( component );
	assert.equal( cleanOutput( component ), "falsefalse", "Initial content" );

	run( content, "pushObjects", [ 3, 4 ] );
	assert.equal( cleanOutput( component ), "falsefalsetruetrue", "Unique items" );

});


QUnit.test( "Duplicates", function( assert ) {

	var content = [ 1, 2 ];
	var layout = compile(
		"{{#content-list content=content as |i n d|}}{{d}}{{/content-list}}"
	);
	component = Component.extend({ content, layout }).create();
	setOwner( component, owner );

	runAppend( component );
	assert.equal( cleanOutput( component ), "falsefalse", "Initial content" );

	run( content, "pushObjects", [ 2, 3 ] );
	assert.equal( cleanOutput( component ), "falsefalsetruefalse", "Duplicates" );

});


QUnit.test( "Simple nested duplicates", function( assert ) {

	var done = assert.async();
	var content = [ { foo: 1 }, { foo: 2 } ];
	var layout = compile(
		"{{#content-list content=content compare='foo' as |i n d|}}{{d}}{{/content-list}}"
	);
	component = Component.extend({ content, layout }).create();
	setOwner( component, owner );

	runAppend( component );
	assert.equal( cleanOutput( component ), "falsefalse", "Initial content" );

	run( content, "pushObjects", [ { foo: 2 }, { foo: 3 } ] );
	run.next(function() {
		assert.equal(
			cleanOutput( component ),
			"falsefalsetruefalse",
			"Added nested duplicates"
		);
		done();
	});

});


QUnit.test( "Deferred nested duplicates", function( assert ) {

	var done = assert.async();
	var a = Ember.RSVP.defer();
	var b = Ember.RSVP.defer();

	a.resolve( 1 );
	var content = [ { foo: a.promise } ];
	var layout = compile(
		"{{#content-list content=content compare='foo' as |i n d|}}{{d}}{{/content-list}}"
	);
	component = Component.extend({ content, layout }).create();
	setOwner( component, owner );

	runAppend( component );
	assert.equal( cleanOutput( component ), "false", "Initial content" );

	run( content, "pushObjects", [ { foo: b.promise } ] );
	run.next(function() {
		assert.equal( cleanOutput( component ),
			"falsefalse",
			"Added unresolved nested duplicate"
		);

		b.resolve( 1 );
		run.next(function() {
			assert.equal( cleanOutput( component ),
				"falsetrue",
				"Resolved nested duplicate"
			);

			done();
		});
	});

});
