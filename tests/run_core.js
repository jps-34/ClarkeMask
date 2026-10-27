// Runs the numeric core under node on frames exported by tests/export_fits.py.
//
//   node tests/run_core.js <prefix> [<prefix> ...]
//
// Bins each frame 2x2, detects around the exported theta (detectAll; with
// CM_SINGLE=1, along theta only), rasterizes the masks at full resolution and
// prints one JSON line per frame. With CM_MASK_DIR set, also writes
// <frame>.mask.bin (uint8, full resolution) into that folder.

"use strict";
const fs = require( "fs" );
const path = require( "path" );
const Core = require( path.join( __dirname, "..", "scripts", "ClarkeMaskCore.js" ) );

const MARGIN = 2;       // full-resolution px across the trail
const END_MARGIN = 8;   // full-resolution px along it

for ( const prefix of process.argv.slice( 2 ) )
{
   const meta = JSON.parse( fs.readFileSync( prefix + ".json", "utf8" ) );
   const buf = fs.readFileSync( prefix + ".bin" );
   const full = new Float32Array( buf.buffer, buf.byteOffset, meta.w * meta.h );
   const t0 = Date.now();
   const b = Core.binMean2( full, meta.w, meta.h );
   const res = process.env.CM_SINGLE ? Core.detect( b.data, b.w, b.h, meta.theta )
                                     : Core.detectAll( b.data, b.w, b.h, meta.theta );
   const mask = new Uint8Array( meta.w * meta.h );
   const masked = Core.rasterize( res, meta.w, meta.h, 2, MARGIN, END_MARGIN, mask );
   if ( process.env.CM_MASK_DIR )   // full-resolution mask, uint8, for visual checks
      fs.writeFileSync( path.join( process.env.CM_MASK_DIR, path.basename( prefix ) + ".mask.bin" ), mask );
   const off = t => t.geometry ? +( ( ( t.geometry.angle - meta.theta + 630 ) % 180 ) - 90 ).toFixed( 2 ) : 0;
   console.log( JSON.stringify( {
      frame: path.basename( prefix ),
      seconds: ( Date.now() - t0 ) / 1000,
      sigPix: +res.sigPix.toFixed( 2 ), sigE: +res.sigE.toFixed( 3 ),
      tCore: +res.tCore.toFixed( 2 ), tEdge: res.tEdge,
      masked: masked,
      trails: res.trails.map( t => ( {
         d: +( 2 * t.centre ).toFixed( 1 ), len: 2 * t.length, width: 2 * t.width,
         peak: +t.peak.toFixed( 1 ), bend: +t.bend.toFixed( 1 ), seg: t.segments,
         grid: t.offset || 0, angle: off( t ),
         x: Math.round( 2 * t.geometry.x + meta.w / 2 ), y: Math.round( 2 * t.geometry.y + meta.h / 2 ) } ) ),
      rejected: res.rejected.map( t => ( { d: +( 2 * t.centre ).toFixed( 1 ), reason: t.reason, angle: off( t ),
         coreWidth: t.coreWidth, bend: +t.bend.toFixed( 1 ), grid: t.offset || 0 } ) )
   } ) );
}
