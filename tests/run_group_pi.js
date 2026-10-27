#engine v8
// Runs the engine on a group of frames in preview mode (frames untouched), with
// a given number of detection threads, to compare threaded and serial runs.
//
//   PixInsight.sh -n --automation-mode --no-startup-scripts \
//     -r="<clone>/tests/run_group_pi.js,<out_dir>,<threads>,<frame1>,<frame2>,..." --force-exit
//
// <threads>: 1 = serial, 0 = automatic. Writes the masks, reports and coverage
// map into <out_dir>, plus run.log; an error goes to <out_dir>/error.txt
// (automation mode shows nothing). Paths without commas. Compare two runs with
// tests/compare_runs.py. A script run with -r needs the #engine v8 directive:
// without it, PixInsight 1.9 runs it on the legacy SpiderMonkey engine.

var HERE = File.extractDrive( #__FILE__ ) + File.extractDirectory( #__FILE__ );
( 0, eval )( File.readTextFile( HERE + "/../scripts/ClarkeMaskCore.js" ) );
( 0, eval )( File.readTextFile( HERE + "/../scripts/ClarkeMaskEngine.js" ) );

function main()
{
   var a = jsArguments, out = a[0], lines = [];
   try
   {
      ClarkeMaskEngine.processGroup( a.slice( 2 ), {
         dryRun: true, outputDir: out, threads: parseInt( a[1] ),
         log: function( s ) { lines.push( s ); }
      } );
   }
   catch ( e )
   {
      File.writeTextFile( out + "/error.txt", "" + e );
   }
   File.writeTextFile( out + "/run.log", lines.join( "\n" ) + "\n" );
}

main();
