/*
 * ClarkeMaskEngine.js
 * Copyright (c) 2026 Jacques Pouyaud. MIT License (see LICENSE).
 * Code written by Claude (Anthropic), under the direction of Jacques Pouyaud.
 *
 * PixInsight layer of ClarkeMask: reads frames, takes the trail direction
 * from the astrometric solution, runs the numeric core (ClarkeMaskCore,
 * which must be loaded first), writes 0 under the masks in every channel,
 * and writes one mask file per frame, a coverage map and a CSV report.
 *
 * With PixInsight 1.9.5 and later, the frames of a group are detected in
 * parallel on Thread objects (each with a JavaScript runtime of its own, where
 * the core is rebuilt from the source of ClarkeMaskCoreFactory); the main
 * thread masks and saves the frames in order as their detections arrive. Same
 * code, same results as the serial path.
 *
 * No #include here: the WBPP event script loads this file with eval, where
 * preprocessor directives and the pjsr/*.jsh constants are not available.
 */

var ClarkeMaskEngine = ( function()
{
   "use strict";

   var NO_SWAP_FILE = 0xFFFFFFFF;    // UndoFlag_NoSwapFile
   var MASK_HINTS = "compression-codec zlib+sh";

   var DEFAULTS = {
      margin: 2,            // full-resolution px added across each trail
      endMargin: 8,         // full-resolution px added at each end
      binning: 2,           // detection image binning
      outputDir: "",        // masks, coverage map and report ("" = no files)
      writeMasks: true,     // one <frame>_mask.xisf per frame with trails
      dryRun: false,        // preview: masks, report and predicted cost; frames not modified
      copyTo: "",           // folder: write masked copies <frame>_cm.xisf there; "" = in place (WBPP)
      noData: 0,            // value written under the masks: 0 (PixInsight range rejection) or NaN
      abort: null,          // function returning true to stop between frames
      onFrame: null,        // function( result ) called after each frame
      onProgress: null,     // function() called during the detection of a frame (UI events)
      lowCoverage: 0.5,     // warn where fewer than this fraction of the frames remain
      detect: null,         // options passed to ClarkeMaskCore.detectAll
      threads: null,        // detection threads: null = setting ClarkeMask/threads, 0 = automatic, 1 = serial
      log: null             // function( text ); console by default
   };

   function options( o )
   {
      var opt = {};
      for ( var k in DEFAULTS ) opt[k] = DEFAULTS[k];
      if ( o ) for ( var k2 in o ) opt[k2] = o[k2];
      if ( !opt.log ) opt.log = function( s ) { console.writeln( "ClarkeMask: " + s ); console.flush(); };
      return opt;
   }

   function baseName( path )
   {
      return File.extractName( path );
   }

   // ------------------------------------------------------------- user settings
   // Saved in the PixInsight settings, so that the WBPP event script uses what
   // the user chose in the dialog.

   var SETTINGS = {
      maxAngle: { key: "ClarkeMask/maxAngle", min: 0, max: 10, detect: true },                   // deg
      maxConfirmedAngle: { key: "ClarkeMask/maxConfirmedAngle", min: 0, max: 15, detect: true }, // deg
      threads: { key: "ClarkeMask/threads", min: 0, max: 256, def: 0, integer: true }            // 0 = automatic
   };

   function readSettings()
   {
      // {maxAngle, maxConfirmedAngle, threads}: saved values, the defaults
      // (core defaults for the detection settings) when absent or invalid.
      var s = {};
      for ( var name in SETTINGS )
      {
         var st = SETTINGS[name];
         s[name] = st.detect ? ClarkeMaskCore.DEFAULTS[name] : st.def;
         try
         {
            var v = Settings.read( st.key, DataType.Double );
            if ( Settings.lastReadOK && v !== null && isFinite( v ) )
            {
               s[name] = Math.min( Math.max( v, st.min ), st.max );
               if ( st.integer ) s[name] = Math.round( s[name] );
            }
         }
         catch ( e ) {}
      }
      return s;
   }

   function saveSettings( s )
   {
      for ( var name in SETTINGS )
         if ( s[name] !== undefined )
            Settings.write( SETTINGS[name].key, DataType.Double, s[name] );
   }

   // ------------------------------------------------------------- direction

   function astrometricAngle( win )
   {
      // Normal angle of the constant-declination direction at the image
      // centre, in image pixel coordinates; null without a solution.
      if ( !win.hasAstrometricSolution )
         return null;
      var img = win.mainView.image;
      var c = win.imageToCelestial( img.width / 2, img.height / 2 );
      var dra = 0.05 / Math.max( Math.cos( c.y * Math.PI / 180 ), 0.01 );
      var a = win.celestialToImage( c.x - dra, c.y ), b = win.celestialToImage( c.x + dra, c.y );
      if ( !a || !b )
         return null;
      return ClarkeMaskCore.normalAngle( b.x - a.x, b.y - a.y );
   }

   function astrometricGeometry( win )
   {
      // {theta, scale (arcsec per px), dec (deg)} at the image centre; null
      // without a solution.
      var theta = astrometricAngle( win );
      if ( theta === null )
         return null;
      var img = win.mainView.image, cx = img.width / 2, cy = img.height / 2;
      var p = win.imageToCelestial( cx, cy ), q = win.imageToCelestial( cx + 10, cy );
      var r = Math.PI / 180, cosd = Math.sin( p.y * r ) * Math.sin( q.y * r ) +
              Math.cos( p.y * r ) * Math.cos( q.y * r ) * Math.cos( ( q.x - p.x ) * r );
      var scale = Math.acos( Math.min( 1, cosd ) ) / r * 3600 / 10;
      return { theta: theta, scale: scale, dec: p.y, width: img.width, height: img.height, channels: img.numberOfChannels };
   }

   function geometryFromFile( path )
   {
      var ws = ImageWindow.open( path, "", "", true );
      if ( ws.length < 1 )
         return null;
      try
      {
         return astrometricGeometry( ws[0] );
      }
      finally
      {
         for ( var i = 0; i < ws.length; ++i ) ws[i].forceClose();
      }
   }

   function angleFromFile( path )
   {
      var g = geometryFromFile( path );
      return g ? g.theta : null;
   }

   function exposureTime( win )
   {
      return exposureFromKeywords( win.keywords );
   }

   function exposureFromKeywords( kw )
   {
      // Exposure in seconds from the EXPTIME or EXPOSURE keyword, 0 if absent.
      for ( var i = 0; i < kw.length; ++i )
         if ( kw[i].name == "EXPTIME" || kw[i].name == "EXPOSURE" )
         {
            var v = parseFloat( String( kw[i].value ).replace( /'/g, "" ) );
            if ( v > 0 ) return v;
         }
      return 0;
   }

   function expectedLength( sky, exposure, binning )
   {
      // Length of a geosynchronous trail in this exposure, detection-image px
      // (report and confirmation by length); 0 when unknown. Sidereal rate:
      // 15.0411 arcsec per second of time along a declination circle at the
      // equator.
      if ( !sky || !( exposure > 0 ) )
         return 0;
      return 15.0411 * Math.cos( sky.dec * Math.PI / 180 ) * exposure / sky.scale / binning;
   }

   // ------------------------------------------------------------- frames

   function channelData( img, c )
   {
      var data = new Float32Array( img.width * img.height );
      img.getSamples( data, new Rect( 0, 0, img.width, img.height ), c );
      return data;
   }

   function detectionImage( img, binning )
   {
      // Mean of the channels, binned 2x2. A pixel at 0 or NaN in any channel
      // carries no data and gives 0.
      var n = img.width * img.height, nc = img.numberOfChannels, sum = channelData( img, 0 );
      for ( var c = 1; c < nc; ++c )
      {
         var d = channelData( img, c );
         for ( var i = 0; i < n; ++i )
            sum[i] = ( sum[i] == 0 || d[i] == 0 ) ? 0 : sum[i] + d[i];
      }
      for ( var j = 0; j < n; ++j )
         sum[j] = sum[j] == sum[j] ? sum[j] / nc : 0;
      if ( binning != 2 )
         throw new Error( "Only binning 2 is supported" );
      return ClarkeMaskCore.binMean2( sum, img.width, img.height );
   }

   function applyMask( win, mask, value )
   {
      // Writes value (0 or NaN) under the mask in every channel.
      var view = win.mainView, img = view.image;
      view.beginProcess( NO_SWAP_FILE );
      try
      {
         for ( var c = 0; c < img.numberOfChannels; ++c )
         {
            var d = channelData( img, c );
            for ( var i = 0; i < d.length; ++i )
               if ( mask[i] ) d[i] = value;
            img.setSamples( d, new Rect( 0, 0, img.width, img.height ), c );
         }
      }
      finally
      {
         view.endProcess();
      }
   }

   function addHistory( win, text )
   {
      var kw = win.keywords;
      kw.push( new FITSKeyword( "HISTORY", "", text ) );
      win.keywords = kw;
   }

   function saveCopy( win, path )
   {
      // Writes the masked frame as a new XISF file; the input is not touched.
      var dir = File.extractDrive( path ) + File.extractDirectory( path );
      if ( !File.directoryExists( dir ) )
         File.createDirectory( dir, true );
      if ( File.exists( path ) )
         File.remove( path );
      if ( !win.saveAs( path, false /*query*/, false /*messages*/, false /*strict*/, false /*verifyOverwrite*/ ) )
         throw new Error( "Unable to write " + path );
   }

   function saveInPlace( win, path )
   {
      // Writes to a temporary file next to the original, then replaces it, so
      // that a failure never leaves a half-written frame.
      var tmp = File.extractDrive( path ) + File.extractDirectory( path ) + "/" + baseName( path ) +
                "_cmtmp" + File.extractExtension( path );
      if ( File.exists( tmp ) )
         File.remove( tmp );
      if ( !win.saveAs( tmp, false /*query*/, false /*messages*/, false /*strict*/, false /*verifyOverwrite*/ ) )
         throw new Error( "Unable to write " + tmp );
      File.remove( path );
      File.move( tmp, path );
   }

   function writeImage( path, data, w, h, bits, real, hints )
   {
      // Writes a one-channel image ([0,1] data) as XISF, with bits per sample
      // and integer or floating point samples as given (without setOptions()
      // the file gets the default 16-bit integer format).
      var win = new ImageWindow( w, h, 1, bits, real, false /*color*/, "ClarkeMask_tmp" );
      try
      {
         var view = win.mainView;
         view.beginProcess( NO_SWAP_FILE );
         view.image.setSamples( data, new Rect( 0, 0, w, h ), 0 );
         view.endProcess();
         var F = new FileFormat( ".xisf", false /*read*/, true /*write*/ );
         var f = new FileFormatInstance( F );
         if ( !f.create( path, hints || "" ) )
            throw new Error( "Unable to create " + path );
         var d = new ImageDescription;
         d.bitsPerSample = bits;
         d.ieeefpSampleFormat = real;
         if ( !f.setOptions( d ) )
            throw new Error( "Unable to set the sample format of " + path );
         if ( !f.writeImage( view.image ) )
            throw new Error( "Unable to write " + path );
         f.close();
      }
      finally
      {
         win.forceClose();
      }
   }

   function detectOptions( detect, sky, exposure, binning )
   {
      // Options of detectAll for one frame: the caller's, with the expected
      // length of a geosynchronous trail when it is known.
      var dopt = {};
      if ( detect ) for ( var k in detect ) dopt[k] = detect[k];
      var el = expectedLength( sky, exposure, binning );
      if ( el > 0 ) dopt.expectedLength = el;
      return dopt;
   }

   function processFrame( path, theta, opt, coverage, found )
   {
      // Detects and masks the trails of one frame. coverage: optional
      // {count: Uint16Array, w, h, frames} updated with the valid pixels left.
      // found: the detection of this frame already made by a thread
      // (frameDetection), or none.
      var t0 = Date.now();
      var ws = ImageWindow.open( path, "", "", true );
      if ( ws.length < 1 )
         throw new Error( "Unable to open " + path );
      for ( var k = 1; k < ws.length; ++k ) ws[k].forceClose();
      var win = ws[0];
      try
      {
         var img = win.mainView.image, W = img.width, H = img.height, res, exposure, length;
         if ( found )
         {
            if ( found.width != W || found.height != H )
               throw new Error( "the detection thread read an image of another size" );
            res = found.result; exposure = found.exposure; length = found.expectedLength;
         }
         else
         {
            exposure = exposureTime( win );
            var det = detectionImage( img, opt.binning ), dopt = detectOptions( opt.detect, opt.sky, exposure, opt.binning );
            if ( opt.onProgress ) dopt.onGrid = opt.onProgress;
            res = ClarkeMaskCore.detectAll( det.data, det.w, det.h, theta, dopt );
            length = dopt.expectedLength || 0;
         }
         var mask = new Uint8Array( W * H );
         var pixels = ClarkeMaskCore.rasterize( res, W, H, opt.binning, opt.margin, opt.endMargin, mask );
         // registration borders are 0 in every channel: channel 0 tells the valid pixels
         var valid = coverage ? channelData( img, 0 ) : null;
         if ( pixels > 0 )
         {
            // dry run (preview): masks and report only, the frame is not touched
            if ( !opt.dryRun )
            {
               applyMask( win, mask, opt.noData );
               addHistory( win, "ClarkeMask " + ClarkeMaskCore.VERSION + ": " + res.trails.length + " trails, " +
                           pixels + " pixels set to " + opt.noData );
               if ( opt.copyTo )
                  saveCopy( win, opt.copyTo + "/" + baseName( path ) + "_cm.xisf" );
               else
                  saveInPlace( win, path );
            }
            if ( opt.outputDir && opt.writeMasks )
            {
               var m = new Float32Array( W * H );
               for ( var i = 0; i < m.length; ++i ) m[i] = mask[i];
               writeImage( opt.outputDir + "/" + baseName( path ) + "_mask.xisf", m, W, H, 8, false, MASK_HINTS );
            }
         }
         if ( coverage )
         {
            if ( !coverage.count )
            {
               coverage.w = W; coverage.h = H;
               coverage.count = new Uint16Array( W * H );     // valid frames after masking
               coverage.before = new Uint16Array( W * H );    // valid frames before masking
            }
            if ( coverage.w == W && coverage.h == H )
            {
               for ( var j = 0; j < valid.length; ++j )
                  if ( valid[j] != 0 && valid[j] == valid[j] )
                  {
                     ++coverage.before[j];
                     if ( !mask[j] ) ++coverage.count[j];    // in a dry run: the predicted cost
                  }
               ++coverage.frames;
            }
         }
         return { file: path, trails: res.trails.length, rejected: res.rejected.length, pixels: pixels,
                  sigPix: res.sigPix, seconds: ( Date.now() - t0 ) / 1000 + ( found ? found.seconds : 0 ), detail: res,
                  exposure: exposure, expectedLength: length * opt.binning };
      }
      finally
      {
         win.forceClose();
      }
   }

   // ------------------------------------------------------------- threads

   function frameDetection( d )
   {
      // Body of a detection thread: reads the frame, builds the detection
      // image and runs detectAll. It runs in a runtime of its own, where only
      // the core and the functions of threadSource() exist (no ImageWindow,
      // nothing of the calling script). d: {path, theta, detect, sky, binning}.
      var t0 = Date.now(), img = new Image, exposure = 0, det, W, H;
      try
      {
         var f = new FileFormatInstance( new FileFormat( File.extractExtension( d.path ), true /*read*/, false /*write*/ ) );
         if ( f.open( d.path, "" ).length < 1 )
            throw new Error( "Unable to open " + d.path );
         try
         {
            try { exposure = exposureFromKeywords( f.keywords ); } catch ( e ) {}   // format without keywords
            if ( !f.readImage( img ) )
               throw new Error( "Unable to read " + d.path );
         }
         finally
         {
            f.close();
         }
         W = img.width; H = img.height;
         det = detectionImage( img, d.binning );
      }
      finally
      {
         img.free();
      }
      var dopt = detectOptions( d.detect, d.sky, exposure, d.binning );
      dopt.onGrid = function( i )
      {
         Thread.current.status = i;
         if ( Thread.current.isAborted )
            throw new Error( "stopped" );
      };
      var res = ClarkeMaskCore.detectAll( det.data, det.w, det.h, d.theta, dopt );
      return { result: res, exposure: exposure, expectedLength: dopt.expectedLength || 0, width: W, height: H,
               seconds: ( Date.now() - t0 ) / 1000 };
   }

   function threadSource()
   {
      // Source code of a detection thread: the core, the helpers that
      // frameDetection() calls, and frameDetection() itself as the value of
      // the script (a Thread calls it with the cloned data).
      var src = [ "var ClarkeMaskCore = ( " + ClarkeMaskCoreFactory.toString() + " )();" ];
      var helpers = [ channelData, detectionImage, exposureFromKeywords, expectedLength, detectOptions ];
      for ( var i = 0; i < helpers.length; ++i )
         src.push( helpers[i].toString() );
      src.push( "( " + frameDetection.toString() + " )" );
      return src.join( "\n" );
   }

   function threadCount( opt, paths )
   {
      // Number of detection threads for a group: 1 (serial) without Thread
      // objects (PixInsight before 1.9.5) or for a single frame; otherwise
      // opt.threads or the setting, and when it is 0 (automatic) as many as
      // the processors allowed by the platform, the frames and the available
      // memory permit (a frame and its detection buffers per thread, from the
      // size of the reference frame, or else of the first file).
      var frames = paths.length;
      if ( typeof Thread === "undefined" || typeof ClarkeMaskCoreFactory !== "function" || frames < 2 )
         return 1;
      var n = opt.threads;
      if ( n === null || n === undefined )
         n = readSettings().threads;
      if ( !( n >= 1 ) )
      {
         n = Thread.numberOfProcessors;
         var mem = null, sky = opt.sky, per = 0;
         try { mem = System.physicalMemoryStatus(); } catch ( e ) {}
         if ( sky && sky.width > 0 )
            per = sky.width * sky.height * 4 * ( sky.channels + 3 );
         else
            try { per = 4 * new FileInfo( paths[0] ).size; } catch ( e ) {}
         if ( mem && mem.availableBytes > 0 && per > 0 )
            n = Math.min( n, Math.floor( 0.6 * mem.availableBytes / ( per + 268435456 ) ) );
      }
      return Math.max( 1, Math.min( Math.round( n ), frames ) );
   }

   function detectionPool( paths, data, n, idle )
   {
      // Detects paths[i] on up to n threads at a time, in the order of i.
      // result( i ) waits for frame i, calling idle() meanwhile, and returns
      // its detection (frameDetection), false when idle() returns true (stop
      // requested), or throws its error. stop() aborts and joins the running
      // threads: it must be called in every case.
      var src = threadSource(), next = 0, running = [], done = {};
      function refill()
      {
         for ( var k = running.length - 1; k >= 0; --k )
            if ( !running[k].thread.isActive )
            {
               var e = running[k];
               e.thread.wait();
               done[e.index] = e.thread.error ? { error: e.thread.error } : { value: e.thread.result };
               running.splice( k, 1 );
            }
         while ( running.length < n && next < paths.length )
         {
            var d = {};
            for ( var key in data ) d[key] = data[key];
            d.path = paths[next];
            var t = new Thread( src, d );
            t.start();
            running.push( { thread: t, index: next++ } );
         }
      }
      refill();
      return {
         result: function( i )
         {
            for ( ;; )
            {
               refill();
               if ( done[i] )
               {
                  var r = done[i];
                  delete done[i];
                  if ( r.error )
                     throw new Error( r.error );
                  return r.value;
               }
               var waiting = null;
               for ( var k = 0; k < running.length && !waiting; ++k )
                  if ( running[k].index == i ) waiting = running[k].thread;
               if ( !waiting )
                  throw new Error( "frame " + i + " was not scheduled for detection" );
               if ( !waiting.wait( 100 ) && idle && idle() )
                  return false;
            }
         },
         stop: function()
         {
            next = paths.length;
            for ( var k = 0; k < running.length; ++k ) running[k].thread.abort();
            for ( var k2 = 0; k2 < running.length; ++k2 ) running[k2].thread.wait();
            running = [];
         }
      };
   }

   // ------------------------------------------------------------- groups

   function coverageStats( coverage, opt )
   {
      // Cost of the masks over the area covered by every frame before masking
      // (registration borders excluded). A pixel that lost k of N frames keeps
      // (N-k)/N of the exposure and, with equal weights, sqrt((N-k)/N) of the
      // SNR. Returns {frames, field, lost: [area for k = 0..N], min, meanSnr,
      // low} and saves the map of the exposure fraction kept.
      var n = coverage.count.length, all = coverage.frames, thr = opt.lowCoverage * all;
      var lost = [], field = 0, snrSum = 0, mn = all, low = 0, m = new Float32Array( n );
      for ( var k = 0; k <= all; ++k ) lost.push( 0 );
      for ( var i = 0; i < n; ++i )
      {
         var c = coverage.count[i];
         m[i] = coverage.before[i] > 0 ? c / coverage.before[i] : 0;
         if ( coverage.before[i] != all )
            continue;
         ++field;
         ++lost[all - c];
         snrSum += Math.sqrt( c / all );
         if ( c < mn ) mn = c;
         if ( c < thr ) ++low;
      }
      if ( opt.outputDir )
         writeImage( opt.outputDir + "/coverage.xisf", m, coverage.w, coverage.h, 32, true, MASK_HINTS );
      return { frames: all, field: field, lost: lost, min: mn, meanSnr: field > 0 ? snrSum / field : 1, low: low };
   }

   function percent( x, digits )
   {
      return ( 100 * x ).toFixed( digits === undefined ? 1 : digits ) + "%";
   }

   function share( x )
   {
      // Share of the field: one decimal from 1% up, two significant digits below.
      var p = 100 * x;
      return ( p == 0 ? "0" : p >= 1 ? p.toFixed( 1 ) : p.toPrecision( 2 ) ) + "%";
   }

   function reportCoverage( cov, opt )
   {
      // Score line, then one line per number of frames lost; also coverage.csv.
      var N = cov.frames, worstK = N - cov.min, lines = [];
      if ( cov.field == 0 )
      {
         opt.log( "coverage: no pixel covered by every frame" );
         return;
      }
      if ( worstK == 0 )
         opt.log( "score: no pixel lost any frame" );
      else
         opt.log( "score: worst " + worstK + " of " + N + " frames lost (exposure kept " + percent( cov.min / N, 0 ) +
                  ", SNR kept " + percent( Math.sqrt( cov.min / N ), 0 ) + ") on " + cov.lost[worstK] + " px (" + share( cov.lost[worstK] / cov.field ) + ")" +
                  " of the field; mean SNR kept over the field " + percent( cov.meanSnr, 2 ) );
      var csv = [ "frames_lost,exposure_kept,snr_kept,pixels,field_fraction" ];
      for ( var k = 0; k <= N; ++k )
      {
         if ( cov.lost[k] == 0 )
            continue;
         var kept = ( N - k ) / N;
         csv.push( k + "," + kept.toFixed( 4 ) + "," + Math.sqrt( kept ).toFixed( 4 ) + "," + cov.lost[k] + "," +
                   ( cov.lost[k] / cov.field ).toFixed( 6 ) );
         if ( k > 0 )
            opt.log( "   " + k + " frame(s) lost: exposure " + percent( kept, 0 ) + ", SNR " + percent( Math.sqrt( kept ), 0 ) +
                     ", " + cov.lost[k] + " px (" + share( cov.lost[k] / cov.field ) + " of the field)" );
      }
      if ( cov.low > 0 )
         opt.log( "** " + cov.low + " px keep less than " + percent( opt.lowCoverage, 0 ) + " of the frames" );
      opt.log( "   (SNR assumes equal frame weights; field = area covered by every frame)" );
      if ( opt.outputDir )
         File.writeTextFile( opt.outputDir + "/coverage.csv", csv.join( "\n" ) + "\n" );
   }

   function processGroup( paths, o )
   {
      // Masks every frame of a registered group. o.theta: trail direction, or
      // taken from the first frame with an astrometric solution (o.reference
      // first, then the frames). Returns {theta, results, failed, coverage}.
      var opt = options( o ), theta = ( opt.theta === undefined || opt.theta === null ) ? null : opt.theta;
      var det = {};
      if ( opt.detect ) for ( var dk in opt.detect ) det[dk] = opt.detect[dk];
      var user = readSettings(), src = {};
      for ( var sn in SETTINGS )
      {
         if ( !SETTINGS[sn].detect )
            continue;
         src[sn] = det[sn] !== undefined ? "given by the caller" : "setting " + SETTINGS[sn].key;
         if ( det[sn] === undefined ) det[sn] = user[sn];
      }
      opt.detect = det;
      opt.log( "trails masked up to " + det.maxAngle + " deg from the belt direction (" + src.maxAngle + ")" +
               ( det.maxConfirmedAngle > det.maxAngle ? ", and up to " + det.maxConfirmedAngle + " deg when their " +
                 "length confirms a geosynchronous object (" + src.maxConfirmedAngle + ")" : "" ) +
               "; other straight trails are reported, not masked" );
      var candidates = ( opt.reference ? [ opt.reference ] : [] ).concat( paths ), sky = null;
      for ( var i = 0; sky === null && i < candidates.length; ++i )
      {
         try { sky = geometryFromFile( candidates[i] ); } catch ( e ) { sky = null; }
         if ( sky !== null )
         {
            if ( theta === null ) theta = sky.theta;
            opt.log( "trail direction " + theta.toFixed( 3 ) + " deg, scale " + sky.scale.toFixed( 3 ) +
                     " arcsec/px, declination " + sky.dec.toFixed( 2 ) + " deg, from " + baseName( candidates[i] ) );
         }
      }
      opt.sky = sky;
      if ( theta === null )
      {
         opt.log( "** no astrometric solution in this group: frames left untouched. ClarkeMask needs one to know " +
                  "the trail direction: plate-solve at acquisition, enable plate solving in WBPP, or solve the " +
                  "reference frame with ImageSolver, then run again" );
         return { theta: null, results: [], failed: paths.slice(), coverage: null };
      }
      if ( opt.outputDir && !File.directoryExists( opt.outputDir ) )
         File.createDirectory( opt.outputDir, true );

      var nth = threadCount( opt, paths ), pool = null, T0 = Date.now();
      if ( nth > 1 )
      {
         opt.log( "detection on " + nth + " threads" );
         pool = detectionPool( paths, { theta: theta, detect: opt.detect, sky: sky, binning: opt.binning }, nth,
                               function()
                               {
                                  if ( opt.onProgress ) opt.onProgress();
                                  return !!( opt.abort && opt.abort() );
                               } );
      }
      var results = [], failed = [], coverage = { count: null, frames: 0 };
      var csv = [ "file,trails,rejected,pixels,sigma,seconds" ];
      var tcsv = [ "file,status,reason,angle_from_belt_deg,length_px,expected_px,length_ratio,length_class,confirmed_by_length,width_px,peak_sigma" ];
      try
      {
         for ( var f = 0; f < paths.length; ++f )
         {
            if ( opt.abort && opt.abort() )
            {
               opt.log( "stopped by the user after " + f + " of " + paths.length + " frames" );
               break;
            }
            try
            {
               var found = null;
               if ( pool )
                  try
                  {
                     found = pool.result( f );
                  }
                  catch ( e )
                  {
                     opt.log( "** " + baseName( paths[f] ) + ": detection thread failed (" + e.message +
                              "), detected in the main thread" );
                  }
               if ( found === false )
               {
                  opt.log( "stopped by the user after " + f + " of " + paths.length + " frames" );
                  break;
               }
               var r = processFrame( paths[f], theta, opt, coverage, found );
               results.push( r );
               if ( opt.onFrame ) opt.onFrame( r );
               csv.push( '"' + baseName( paths[f] ) + '",' + r.trails + "," + r.rejected + "," + r.pixels + "," +
                         r.sigPix.toPrecision( 4 ) + "," + r.seconds.toFixed( 1 ) );
               var classes = {}, rows = [ [ r.detail.trails, "masked" ], [ r.detail.rejected, "reported" ] ];
               for ( var rw = 0; rw < rows.length; ++rw )
                  for ( var ti = 0; ti < rows[rw][0].length; ++ti )
                  {
                     var t = rows[rw][0][ti], a = ( t.geometry.angle - theta + 630 ) % 180 - 90;
                     if ( rw == 0 && t.lengthClass ) classes[t.lengthClass] = ( classes[t.lengthClass] || 0 ) + 1;
                     if ( rw == 0 && t.confirmedByLength ) classes["confirmed by length"] = ( classes["confirmed by length"] || 0 ) + 1;
                     tcsv.push( '"' + baseName( paths[f] ) + '",' + rows[rw][1] + "," + ( t.reason || "" ) + "," +
                                a.toFixed( 2 ) + "," + Math.round( 2 * opt.binning * t.geometry.half ) + "," +
                                Math.round( r.expectedLength ) + "," + ( t.lengthRatio ? t.lengthRatio.toFixed( 2 ) : "" ) + "," +
                                ( t.lengthClass || "" ) + "," + ( t.confirmedByLength ? "yes" : "" ) + "," + opt.binning * t.width + "," + t.peak.toFixed( 1 ) );
                  }
               var cl = Object.keys( classes ).map( function( k ) { return classes[k] + " " + k; } ).join( ", " );
               opt.log( ( f + 1 ) + "/" + paths.length + " " + baseName( paths[f] ) + ": " + r.trails + " trails" +
                        ( cl ? " (" + cl + ")" : "" ) + ", " + r.pixels + " px masked" +
                        ( r.rejected ? ", " + r.rejected + " reported" : "" ) + " (" + r.seconds.toFixed( 1 ) + " s)" );
            }
            catch ( e )
            {
               failed.push( paths[f] );
               opt.log( "** " + baseName( paths[f] ) + " left untouched: " + e.message );
            }
         }
      }
      finally
      {
         if ( pool ) pool.stop();   // every thread joined, also on a stop or an error
      }
      opt.log( results.length + " frames in " + ( ( Date.now() - T0 ) / 1000 ).toFixed( 1 ) + " s" +
               ( nth > 1 ? " (" + nth + " detection threads)" : "" ) );
      var cov = null;
      if ( coverage.count )
      {
         cov = coverageStats( coverage, opt );
         reportCoverage( cov, opt );
      }
      if ( opt.outputDir )
      {
         File.writeTextFile( opt.outputDir + "/ClarkeMask.csv", csv.join( "\n" ) + "\n" );
         File.writeTextFile( opt.outputDir + "/trails.csv", tcsv.join( "\n" ) + "\n" );
      }
      if ( results.length > 0 && results[0].expectedLength > 0 )
         opt.log( "expected length of a geosynchronous trail: " + Math.round( results[0].expectedLength ) +
                  " px (" + results[0].exposure + " s); length classes are a diagnostic, not a criterion" );
      return { theta: theta, results: results, failed: failed, coverage: cov };
   }

   return {
      DEFAULTS: DEFAULTS,
      SETTINGS: SETTINGS,
      readSettings: readSettings,
      saveSettings: saveSettings,
      astrometricAngle: astrometricAngle,
      angleFromFile: angleFromFile,
      astrometricGeometry: astrometricGeometry,
      processFrame: function( path, theta, o, coverage ) { return processFrame( path, theta, options( o ), coverage ); },
      processGroup: processGroup
   };
} )();
