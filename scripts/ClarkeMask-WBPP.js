/*
 * ClarkeMask-WBPP.js
 * Copyright (c) 2026 Jacques Pouyaud.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Free software under the GNU General Public License, version 3 or (at your
 * option) any later version, WITHOUT ANY WARRANTY; see LICENSE.
 * Code written by Claude (Anthropic), under the direction of Jacques Pouyaud.
 *
 * WBPP event script: masks geostationary satellite trails in the registered
 * light frames, right after registration and before local normalization and
 * integration. Masked pixels are set to 0, which WBPP integration rejects for
 * light frames (range rejection at 0), so each pixel is integrated from the
 * frames that are clean at that place.
 *
 * Use: WBPP > Pipeline > Event Script, select this file in the installed
 * ClarkeMask folder. ClarkeMaskCore.js and ClarkeMaskEngine.js are loaded from
 * the folder of this file. Masks, coverage map and report are written to
 * <WBPP output>/ClarkeMask/<group>/, the log to <WBPP output>/ClarkeMask/.
 *
 * WBPP reports an exception thrown here as a warning and carries on: every
 * failure is therefore logged with a "ClarkeMask:" prefix, and a frame that
 * could not be processed is left untouched.
 */

// Run on its own (Script > Execute Script File), this file only declares the
// hooks above and below: say what to do with it. Inside WBPP, engine exists
// and nothing is printed.
if ( typeof engine === "undefined" )
{
   console.show();
   console.warningln( "ClarkeMask-WBPP.js is a WBPP event script and does nothing on its own. In WBPP, " +
                      "Pipeline tab, 'Event Script' box: tick it, select this file, then run WBPP. " +
                      "To process frames outside WBPP, use Script > JPS > ClarkeMask." );
   console.warningln( "ClarkeMask-WBPP.js est un script d'événement de WBPP et ne fait rien seul. Dans WBPP, " +
                      "onglet Pipeline, cadre « Event Script » : le cocher, choisir ce fichier, puis lancer WBPP. " +
                      "Pour traiter des brutes hors de WBPP : Script > JPS > ClarkeMask." );
}

function __clarkeMaskLog( state, text )
{
   console.noteln( "ClarkeMask: " + text );
   console.flush();
   state.clarkeMaskLog = ( state.clarkeMaskLog || "" ) + text + "\n";
}

function onPipelineStart( env, state )
{
   state.clarkeMaskReady = false;
   state.clarkeMaskGroups = 0;
   try
   {
      var dir = File.extractDrive( engine.pipelineScriptFile ) + File.extractDirectory( engine.pipelineScriptFile );
      // indirect eval: defines ClarkeMaskCore and ClarkeMaskEngine as globals
      ( 0, eval )( File.readTextFile( dir + "/ClarkeMaskCore.js" ) );
      ( 0, eval )( File.readTextFile( dir + "/ClarkeMaskEngine.js" ) );
      state.clarkeMaskReady = true;
      __clarkeMaskLog( state, "ClarkeMask " + ClarkeMaskCore.VERSION + " ready (" + dir + ")" );
   }
   catch ( e )
   {
      __clarkeMaskLog( state, "** unable to load the ClarkeMask files next to the event script: " + e.message );
   }
}

function onOperationDone( env, state )
{
   if ( env.name != "Registration" || !env.group || !state.clarkeMaskReady )
      return;
   var g = env.group;
   if ( g.imageType != ImageType.Light )
      return;
   if ( env.status == OperationBlockStatus.FAILED )
   {
      __clarkeMaskLog( state, "registration failed for this group: nothing masked" );
      return;
   }
   try
   {
      var frames = g.activeFrames(), paths = [], reference;
      for ( var i = 0; i < frames.length; ++i )
      {
         paths.push( frames[i].current );
         if ( frames[i].isReference && reference === undefined )
            reference = frames[i].current;
      }
      if ( paths.length == 0 )
         return;
      var n = ++state.clarkeMaskGroups;
      var out = engine.outputDirectory + "/ClarkeMask/group" + ( n < 10 ? "0" : "" ) + n;
      __clarkeMaskLog( state, "group " + n + ": " + paths.length + " registered frames" );
      var res = ClarkeMaskEngine.processGroup( paths, {
         reference: reference,
         outputDir: out,
         log: function( s ) { __clarkeMaskLog( state, "   " + s ); }
      } );
      if ( res.failed.length > 0 )
         __clarkeMaskLog( state, "** " + res.failed.length + " frame(s) left untouched in group " + n );
   }
   catch ( e )
   {
      __clarkeMaskLog( state, "** error, group left as registered: " + e.message );
   }
}

function onPipelineEnd( env, state )
{
   if ( !state.clarkeMaskLog )
      return;
   try
   {
      var dir = engine.outputDirectory + "/ClarkeMask";
      if ( !File.directoryExists( dir ) )
         File.createDirectory( dir, true );
      File.writeTextFile( dir + "/ClarkeMask.log", state.clarkeMaskLog );
   }
   catch ( e )
   {
      console.warningln( "ClarkeMask: unable to write the log: " + e.message );
   }
}
