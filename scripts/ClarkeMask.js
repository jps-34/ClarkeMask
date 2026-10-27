#engine v8

#feature-id    ClarkeMask : Utilities > ClarkeMask
#feature-info  Masks geostationary satellite trails in registered light frames, so that \
   integration rejects them pixel by pixel. Preview of the masks and of their cost, \
   masked copies (the inputs are never modified), viewing of each frame with its mask, \
   and the settings used by the ClarkeMask WBPP event script. Interface in English or French.

/*
 * ClarkeMask.js  v0.2.1
 * Copyright (c) 2026 Jacques Pouyaud. MIT License (see LICENSE).
 * Code written by Claude (Anthropic), under the direction of Jacques Pouyaud.
 *
 * Dialog of ClarkeMask. The detection lives in ClarkeMaskCore.js, the
 * PixInsight layer in ClarkeMaskEngine.js; the WBPP event script
 * ClarkeMask-WBPP.js uses the same files and the settings saved here.
 *
 * The dialog never modifies its input frames: Preview writes the masks and the
 * report only, Apply writes masked copies (<frame>_cm.xisf) into the output
 * folder. Masking in place is the WBPP event script's job.
 *
 * v0.1.0: first version.
 * v0.2.0: parallel detection on threads (PixInsight 1.9.5), detection threads setting.
 * v0.2.1: trail direction checked against the trails (mirrored astrometric solutions).
 */


#include "ClarkeMaskCore.js"
#include "ClarkeMaskEngine.js"

var TITLE = "ClarkeMask";
var VERSION = "0.2.1";
var KEY = "ClarkeMask/";
var DIALOG_KEYS = [ "language", "outputDir", "noData", "lastFolder" ];
var SCRIPT_DIR = File.extractDrive( #__FILE__ ) + File.extractDirectory( #__FILE__ );
var EVENT_SCRIPT = SCRIPT_DIR + "/ClarkeMask-WBPP.js";
var LANG = "en";
var TIPS = {};

// ============================================================================
// Language
// ============================================================================

function detectLanguage()
{
   try
   {
      var saved = Settings.read( KEY + "language", DataType.String );
      if ( saved == "fr" || saved == "en" )
         return saved;
   }
   catch ( e ) {}
   var names = [ "LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG" ];
   for ( var i = 0; i < names.length; ++i )
   {
      try
      {
         var v = getEnvironmentVariable( names[i] );
         if ( v && v.length > 0 && v != "C" && v != "POSIX" )
            return v.toLowerCase().indexOf( "fr" ) == 0 ? "fr" : "en";
      }
      catch ( e ) {}
   }
   return "en";
}

function L( fr, en )
{
   return LANG == "fr" ? fr : en;
}

// ============================================================================
// Settings of the dialog (the two angles belong to the engine)
// ============================================================================

function readString( name, fallback )
{
   try
   {
      var v = Settings.read( KEY + name, DataType.String );
      if ( Settings.lastReadOK && v !== null )
         return v;
   }
   catch ( e ) {}
   return fallback;
}

function writeString( name, value )
{
   try { Settings.write( KEY + name, DataType.String, String( value ) ); } catch ( e ) {}
}

function removeAllSettings()
{
   // Every key ClarkeMask writes, the dialog's and the engine's.
   for ( var i = 0; i < DIALOG_KEYS.length; ++i )
      try { Settings.remove( KEY + DIALOG_KEYS[i] ); } catch ( e ) {}
   for ( var name in ClarkeMaskEngine.SETTINGS )
      try { Settings.remove( ClarkeMaskEngine.SETTINGS[name].key ); } catch ( e ) {}
}

// ============================================================================
// Helpers
// ============================================================================

function clamp( x, a, b )
{
   return Math.min( Math.max( x, a ), b );
}

function mtf( m, x )
{
   if ( x <= 0 ) return 0;
   if ( x >= 1 ) return 1;
   return ( m - 1 ) * x / ( ( 2 * m - 1 ) * x - m );
}

function applyAutoSTF( view )
{
   var img = view.image;
   var n = img.isColor ? 3 : 1;
   var c0 = 0, m = 0;
   for ( var c = 0; c < n; ++c )
   {
      img.selectedChannel = c;
      var med = img.median();
      var mad = 1.4826 * img.MAD();
      if ( 1 + mad != 1 )
         c0 += med - 2.8 * mad;
      m += med;
   }
   img.resetSelections();
   c0 = clamp( c0 / n, 0, 1 );
   m = mtf( 0.25, m / n - c0 );
   var stf = new ScreenTransferFunction;
   stf.STF = [ [ c0, 1, m, 0, 1 ], [ c0, 1, m, 0, 1 ], [ c0, 1, m, 0, 1 ], [ 0, 1, 0.5, 0, 1 ] ];
   stf.executeOn( view );
}

function num( x )
{
   // Integer with thousands separators in the interface language.
   return String( Math.round( x ) ).replace( /\B(?=(\d{3})+(?!\d))/g, LANG == "fr" ? "\u202f" : "," );
}

function dec( text )
{
   return LANG == "fr" ? String( text ).replace( ".", "," ) : String( text );
}

function pct( x, digits )
{
   return dec( ( 100 * x ).toFixed( digits ) ) + ( LANG == "fr" ? "\u202f%" : "%" );
}

function share( x )
{
   // Share of the field: one decimal from 1% up, two significant digits below.
   var p = 100 * x;
   return dec( p == 0 ? "0" : p >= 1 ? p.toFixed( 1 ) : p.toPrecision( 2 ) ) + ( LANG == "fr" ? "\u202f%" : "%" );
}

function message( text, icon )
{
   ( new MessageBox( text, TITLE, icon === undefined ? StdIcon.Information : icon, StdButton.Ok ) ).execute();
}

function buildTips()
{
   return {
      lang: L( "<p>Langue de l'interface. La fenêtre se rouvre dans la langue choisie.</p>",
               "<p>Interface language. The window reopens in the chosen language.</p>" ),
      frames: L( "<p>Brutes <b>registrées</b> (alignées sur la même référence et portant une solution astrométrique). " +
                 "ClarkeMask ne modifie jamais ces fichiers.</p>",
                 "<p><b>Registered</b> frames (aligned on the same reference and carrying an astrometric solution). " +
                 "ClarkeMask never modifies these files.</p>" ),
      add: L( "<p>Ajouter des brutes registrées (XISF ou FITS).</p>", "<p>Add registered frames (XISF or FITS).</p>" ),
      remove: L( "<p>Retirer les brutes sélectionnées de la liste (les fichiers ne sont pas touchés).</p>",
                 "<p>Remove the selected frames from the list (the files are not touched).</p>" ),
      clear: L( "<p>Vider la liste.</p>", "<p>Clear the list.</p>" ),
      maxAngle: L( "<p><b>Angle maximal par rapport à la ceinture.</b> Un satellite strictement géostationnaire trace sa traînée " +
                   "exactement selon l'est-ouest du ciel ; les géosynchrones inclinés, surtout anciens, tracent des traînées inclinées " +
                   "de quelques degrés. Jusqu'à cet angle, toute traînée droite est masquée. 2,5° par défaut.</p>" +
                   "<p>Une valeur plus grande masque des objets plus inclinés mais allonge la détection, et d'autres types d'objets " +
                   "deviennent plus probables. Réglage enregistré aussitôt et utilisé par le script d'événement de WBPP.</p>",
                   "<p><b>Maximum angle from the belt.</b> A strictly geostationary satellite draws its trail exactly along the " +
                   "east-west direction of the sky; inclined geosynchronous satellites, older ones especially, draw trails tilted by " +
                   "a few degrees. Up to this angle every straight trail is masked. Default 2.5 deg.</p>" +
                   "<p>A larger value masks more inclined objects but makes the detection longer, and other kinds of objects become " +
                   "more likely. Saved at once and used by the WBPP event script.</p>" ),
      maxConfirmed: L( "<p><b>Au-delà, confirmation par la longueur.</b> Un objet géosynchrone défile à la vitesse sidérale, sa " +
                       "traînée a donc une longueur connue (dérive sidérale pendant la pose). Entre l'angle maximal et cette limite, " +
                       "une traînée droite est masquée si sa longueur correspond et si ses deux bouts sont dans l'image ; sinon elle " +
                       "est seulement signalée. 7° par défaut. Nécessite la durée de pose dans les en-têtes. Réglage enregistré " +
                       "aussitôt et utilisé par le script d'événement de WBPP.</p>",
                       "<p><b>Beyond it, confirmation by length.</b> A geosynchronous object moves at the sidereal rate, so its trail " +
                       "has a known length (sidereal drift during the exposure). Between the maximum angle and this limit, a straight " +
                       "trail is masked when its length matches with both ends inside the image; otherwise it is only reported. " +
                       "Default 7 deg. Needs the exposure time in the headers. Saved at once and used by the WBPP event script.</p>" ),
      threads: L( "<p><b>Threads de détection.</b> Les brutes d'un groupe sont détectées en parallèle, une par thread ; " +
                  "le masquage et l'enregistrement restent faits dans l'ordre. Mêmes résultats qu'en série.</p>" +
                  "<p><b>Auto</b> (par défaut) : autant de threads que de processeurs permis par les préférences de PixInsight, " +
                  "limité par la mémoire disponible (chaque thread garde une brute en mémoire). <b>1</b> : détection en série. " +
                  "Nécessite PixInsight 1.9.5 ; en version antérieure, la détection est en série. Réglage enregistré aussitôt " +
                  "et utilisé par le script d'événement de WBPP.</p>",
                  "<p><b>Detection threads.</b> The frames of a group are detected in parallel, one per thread; masking and " +
                  "saving are still done in order. Same results as in series.</p>" +
                  "<p><b>Auto</b> (default): as many threads as the processors allowed by the PixInsight preferences, limited by " +
                  "the available memory (each thread holds one frame in memory). <b>1</b>: serial detection. Needs PixInsight " +
                  "1.9.5; with earlier versions the detection is serial. Saved at once and used by the WBPP event script.</p>" ),
      noData: L( "<p>Valeur écrite sous les masques dans les copies masquées.</p>" +
                 "<p><b>0</b> : pour PixInsight (ImageIntegration, WBPP), qui rejette les pixels à 0 des brutes (réjection basse " +
                 "« Clip low range » à 0, active par défaut dans WBPP).</p>" +
                 "<p><b>NaN</b> : pour d'autres logiciels d'empilement qui ignorent les NaN. Pas pour ImageIntegration.</p>",
                 "<p>Value written under the masks in the masked copies.</p>" +
                 "<p><b>0</b>: for PixInsight (ImageIntegration, WBPP), which rejects light-frame pixels at 0 (range rejection " +
                 "'Clip low range' at 0, enabled by default in WBPP).</p>" +
                 "<p><b>NaN</b>: for other stackers that ignore NaN. Not for ImageIntegration.</p>" ),
      output: L( "<p>Dossier où sont écrits les masques (un par brute), la carte de couverture, les rapports (CSV) et, avec " +
                 "Appliquer, les copies masquées &lt;brute&gt;_cm.xisf.</p>" +
                 "<p>Pour <b>visualiser les résultats d'un passage WBPP</b>, choisir ici le dossier " +
                 "&lt;sortie WBPP&gt;/ClarkeMask/groupNN et ajouter les brutes registrées correspondantes.</p>",
                 "<p>Folder where the masks (one per frame), the coverage map, the reports (CSV) and, with Apply, the masked " +
                 "copies &lt;frame&gt;_cm.xisf are written.</p>" +
                 "<p>To <b>view the results of a WBPP run</b>, choose the folder &lt;WBPP output&gt;/ClarkeMask/groupNN here and " +
                 "add the corresponding registered frames.</p>" ),
      preview: L( "<p>Détecter les traînées et écrire les masques et le rapport dans le dossier de sortie, avec le coût prévu. " +
                  "Les brutes ne sont pas modifiées et aucune copie n'est écrite.</p>",
                  "<p>Detect the trails and write the masks and the report into the output folder, with the predicted cost. " +
                  "The frames are not modified and no copy is written.</p>" ),
      apply: L( "<p>Comme Prévisualiser, et écrire en plus une copie masquée de chaque brute qui a des traînées " +
                "(&lt;brute&gt;_cm.xisf) dans le dossier de sortie. Les brutes d'origine ne sont jamais modifiées.</p>",
                "<p>Like Preview, and also write a masked copy of each frame with trails (&lt;frame&gt;_cm.xisf) into the " +
                "output folder. The original frames are never modified.</p>" ),
      show: L( "<p>Ouvrir la brute sélectionnée avec son masque en surimpression (masque PixInsight). Utilise le masque " +
               "&lt;brute&gt;_mask.xisf du dossier de sortie.</p>",
               "<p>Open the selected frame with its mask shown as an overlay (PixInsight mask). Uses the mask " +
               "&lt;frame&gt;_mask.xisf of the output folder.</p>" ),
      coverage: L( "<p>Ouvrir la carte de couverture du dossier de sortie : fraction de la pose conservée par pixel " +
                   "(1 = intacte).</p>",
                   "<p>Open the coverage map of the output folder: fraction of the exposure kept per pixel (1 = untouched).</p>" ),
      wbpp: L( "<p>Dans WBPP, onglet Pipeline, « Event Script » : activer et choisir ce fichier. ClarkeMask masque alors chaque " +
               "groupe de lights juste après la registration, avant la normalisation locale et l'intégration, avec les angles " +
               "réglés ici. Masques et rapports dans &lt;sortie WBPP&gt;/ClarkeMask/.</p>",
               "<p>In WBPP, Pipeline tab, 'Event Script': enable it and select this file. ClarkeMask then masks each light group " +
               "right after registration, before local normalization and integration, with the angles set here. Masks and " +
               "reports in &lt;WBPP output&gt;/ClarkeMask/.</p>" ),
      reset: L( "<p>Remettre tous les réglages à leur valeur par défaut et oublier ceux enregistrés, <b>y compris les angles " +
                "utilisés par le script d'événement de WBPP</b>.</p>",
                "<p>Put every setting back to its default and forget the saved ones, <b>including the angles used by the WBPP " +
                "event script</b>.</p>" ),
      stop: L( "<p>Arrêter après la brute en cours.</p>", "<p>Stop after the current frame.</p>" ),
      close: L( "<p>Fermer.</p>", "<p>Close.</p>" )
   };
}

// ============================================================================
// Dialog
// ============================================================================

var ClarkeMaskDialog = class extends Dialog {
constructor()
{
   super();
   var self = this;
   this.windowTitle = TITLE + " " + VERSION;
   this.relaunch = false;
   this.running = false;
   this.stopRequested = false;
   this.lastSummary = "";

   // --- help and language ---------------------------------------------------
   this.helpLabel = new Label( this );
   this.helpLabel.useRichText = true;
   this.helpLabel.wordWrapping = true;
   this.helpLabel.text = L(
      "<p><b>Masquage des traînées de satellites géostationnaires</b> dans des brutes registrées, pour que l'intégration " +
      "les rejette pixel par pixel. <i>1. Ajouter les brutes registrées, 2. Prévisualiser (masques et coût, rien n'est " +
      "modifié), 3. vérifier une brute avec son masque, 4. Appliquer (copies masquées). Avec WBPP, utiliser plutôt le " +
      "script d'événement ci-dessous. Survoler un réglage pour une explication.</i></p>",
      "<p><b>Masking of geostationary satellite trails</b> in registered frames, so that integration rejects them pixel by " +
      "pixel. <i>1. Add the registered frames, 2. Preview (masks and cost, nothing is modified), 3. check a frame with its " +
      "mask, 4. Apply (masked copies). With WBPP, use the event script below instead. Hover over any setting for an " +
      "explanation.</i></p>" );
   this.langLabel = new Label( this );
   this.langLabel.text = "Langue / Language :";
   this.langLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.langLabel.toolTip = TIPS.lang;
   this.langCombo = new ComboBox( this );
   this.langCombo.addItem( "English" );
   this.langCombo.addItem( "Français" );
   this.langCombo.currentItem = LANG == "fr" ? 1 : 0;
   this.langCombo.toolTip = TIPS.lang;
   this.langCombo.onItemSelected = function( idx )
   {
      var nl = idx == 1 ? "fr" : "en";
      if ( nl == LANG || self.running )
         return;
      writeString( "language", nl );
      LANG = nl;
      self.relaunch = true;
      self.storeState();
      self.ok();
   };
   var topRow = new HorizontalSizer;
   topRow.spacing = 8;
   topRow.add( this.helpLabel, 100 );
   topRow.add( this.langLabel );
   topRow.add( this.langCombo );

   // --- frames --------------------------------------------------------------
   this.list = new TreeBox( this );
   this.list.numberOfColumns = 6;
   this.list.headerVisible = true;
   this.list.rootDecoration = false;
   this.list.alternateRowColor = true;
   this.list.multipleSelection = true;
   var headers = [ L( "Brute", "Frame" ), L( "Traînées", "Trails" ), L( "Px masqués", "Masked px" ),
                   L( "Confirmées", "Confirmed" ), L( "Signalées", "Reported" ), L( "État", "Status" ) ];
   for ( var h = 0; h < headers.length; ++h )
      this.list.setHeaderText( h, headers[h] );
   this.list.toolTip = TIPS.frames;
   this.list.setMinHeight( this.logicalPixelsToPhysical( 180 ) );
   this.list.onNodeDoubleClicked = function() { self.showSelected(); };

   this.addButton = new PushButton( this );
   this.addButton.text = L( "Ajouter des brutes...", "Add frames..." );
   this.addButton.toolTip = TIPS.add;
   this.addButton.onClick = function() { self.addFiles(); };
   this.removeButton = new PushButton( this );
   this.removeButton.text = L( "Retirer", "Remove" );
   this.removeButton.toolTip = TIPS.remove;
   this.removeButton.onClick = function() { self.removeSelected(); };
   this.clearButton = new PushButton( this );
   this.clearButton.text = L( "Vider", "Clear" );
   this.clearButton.toolTip = TIPS.clear;
   this.clearButton.onClick = function() { self.list.clear(); };
   var listButtons = new HorizontalSizer;
   listButtons.spacing = 6;
   listButtons.add( this.addButton );
   listButtons.add( this.removeButton );
   listButtons.add( this.clearButton );
   listButtons.addStretch();

   this.framesGroup = new GroupBox( this );
   this.framesGroup.title = L( "Brutes registrées", "Registered frames" );
   this.framesGroup.sizer = new VerticalSizer;
   this.framesGroup.sizer.margin = 6;
   this.framesGroup.sizer.spacing = 4;
   this.framesGroup.sizer.add( this.list, 100 );
   this.framesGroup.sizer.add( listButtons );

   // --- settings ------------------------------------------------------------
   var user = ClarkeMaskEngine.readSettings(), S = ClarkeMaskEngine.SETTINGS;
   var labelWidth = this.font.width( L( "Confirmation par la longueur jusqu'à (°) :", "Confirmation by length up to (deg):" ) ) + 8;

   this.maxAngleControl = new NumericControl( this );
   this.maxAngleControl.label.text = L( "Angle maximal par rapport à la ceinture (°) :", "Maximum angle from the belt (deg):" );
   this.maxAngleControl.label.minWidth = labelWidth;
   this.maxAngleControl.setRange( S.maxAngle.min, S.maxAngle.max );
   this.maxAngleControl.slider.setRange( 0, 200 );
   this.maxAngleControl.setPrecision( 2 );
   this.maxAngleControl.setValue( user.maxAngle );
   this.maxAngleControl.toolTip = TIPS.maxAngle;
   this.maxAngleControl.onValueUpdated = function( v ) { ClarkeMaskEngine.saveSettings( { maxAngle: v } ); self.updateAngleNote(); };

   this.maxConfirmedControl = new NumericControl( this );
   this.maxConfirmedControl.label.text = L( "Confirmation par la longueur jusqu'à (°) :", "Confirmation by length up to (deg):" );
   this.maxConfirmedControl.label.minWidth = labelWidth;
   this.maxConfirmedControl.setRange( S.maxConfirmedAngle.min, S.maxConfirmedAngle.max );
   this.maxConfirmedControl.slider.setRange( 0, 300 );
   this.maxConfirmedControl.setPrecision( 2 );
   this.maxConfirmedControl.setValue( user.maxConfirmedAngle );
   this.maxConfirmedControl.toolTip = TIPS.maxConfirmed;
   this.maxConfirmedControl.onValueUpdated = function( v ) { ClarkeMaskEngine.saveSettings( { maxConfirmedAngle: v } ); self.updateAngleNote(); };

   this.threadsLabel = new Label( this );
   this.threadsLabel.text = L( "Threads de détection :", "Detection threads:" );
   this.threadsLabel.minWidth = labelWidth;
   this.threadsLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.threadsLabel.toolTip = TIPS.threads;
   this.threadsSpin = new SpinBox( this );
   this.threadsSpin.setRange( S.threads.min, S.threads.max );
   this.threadsSpin.minimumValueText = "Auto";
   this.threadsSpin.value = user.threads;
   this.threadsSpin.toolTip = TIPS.threads;
   this.threadsSpin.onValueUpdated = function( v ) { ClarkeMaskEngine.saveSettings( { threads: v } ); };
   var threadsRow = new HorizontalSizer;
   threadsRow.spacing = 6;
   threadsRow.add( this.threadsLabel );
   threadsRow.add( this.threadsSpin );
   threadsRow.addStretch();

   this.angleNote = new Label( this );
   this.angleNote.useRichText = true;
   this.angleNote.wordWrapping = true;
   this.angleNote.visible = false;

   this.noDataLabel = new Label( this );
   this.noDataLabel.text = L( "Valeur sous les masques :", "Value under the masks:" );
   this.noDataLabel.minWidth = labelWidth;
   this.noDataLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.noDataLabel.toolTip = TIPS.noData;
   this.noDataCombo = new ComboBox( this );
   this.noDataCombo.addItem( L( "0 (PixInsight : ImageIntegration, WBPP)", "0 (PixInsight: ImageIntegration, WBPP)" ) );
   this.noDataCombo.addItem( L( "NaN (autres logiciels, pas ImageIntegration)", "NaN (other stackers, not ImageIntegration)" ) );
   this.noDataCombo.currentItem = readString( "noData", "0" ) == "NaN" ? 1 : 0;
   this.noDataCombo.toolTip = TIPS.noData;
   this.noDataCombo.onItemSelected = function( idx ) { writeString( "noData", idx == 1 ? "NaN" : "0" ); };
   var noDataRow = new HorizontalSizer;
   noDataRow.spacing = 6;
   noDataRow.add( this.noDataLabel );
   noDataRow.add( this.noDataCombo );
   noDataRow.addStretch();

   this.outputLabel = new Label( this );
   this.outputLabel.text = L( "Dossier de sortie :", "Output folder:" );
   this.outputLabel.minWidth = labelWidth;
   this.outputLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.outputLabel.toolTip = TIPS.output;
   this.outputEdit = new Edit( this );
   this.outputEdit.text = readString( "outputDir", "" );
   this.outputEdit.toolTip = TIPS.output;
   this.outputEdit.onEditCompleted = function() { writeString( "outputDir", self.outputEdit.text.trim() ); };
   this.outputBrowse = new ToolButton( this );
   this.outputBrowse.icon = this.scaledResource( ":/icons/select-file.png" );
   this.outputBrowse.setScaledFixedSize( 24, 24 );
   this.outputBrowse.toolTip = TIPS.output;
   this.outputBrowse.onClick = function()
   {
      var gdd = new GetDirectoryDialog;
      gdd.caption = L( "Dossier de sortie", "Output folder" );
      if ( self.outputEdit.text.trim().length > 0 )
         gdd.initialPath = self.outputEdit.text.trim();
      if ( gdd.execute() )
      {
         self.outputEdit.text = gdd.directory;
         writeString( "outputDir", gdd.directory );
      }
   };
   var outputRow = new HorizontalSizer;
   outputRow.spacing = 6;
   outputRow.add( this.outputLabel );
   outputRow.add( this.outputEdit, 100 );
   outputRow.add( this.outputBrowse );

   this.settingsGroup = new GroupBox( this );
   this.settingsGroup.title = L( "Réglages", "Settings" );
   this.settingsGroup.sizer = new VerticalSizer;
   this.settingsGroup.sizer.margin = 6;
   this.settingsGroup.sizer.spacing = 4;
   this.settingsGroup.sizer.add( this.maxAngleControl );
   this.settingsGroup.sizer.add( this.maxConfirmedControl );
   this.settingsGroup.sizer.add( this.angleNote );
   this.settingsGroup.sizer.add( threadsRow );
   this.settingsGroup.sizer.add( noDataRow );
   this.settingsGroup.sizer.add( outputRow );

   // --- results -------------------------------------------------------------
   this.summaryLabel = new Label( this );
   this.summaryLabel.useRichText = true;
   this.summaryLabel.wordWrapping = true;
   this.summaryLabel.text = L( "<i>Pas encore de résultat.</i>", "<i>No result yet.</i>" );
   this.showButton = new PushButton( this );
   this.showButton.text = L( "Voir la brute et son masque", "Show frame with its mask" );
   this.showButton.toolTip = TIPS.show;
   this.showButton.onClick = function() { self.showSelected(); };
   this.coverageButton = new PushButton( this );
   this.coverageButton.text = L( "Voir la carte de couverture", "Show coverage map" );
   this.coverageButton.toolTip = TIPS.coverage;
   this.coverageButton.onClick = function() { self.showCoverage(); };
   var viewRow = new HorizontalSizer;
   viewRow.spacing = 6;
   viewRow.add( this.showButton );
   viewRow.add( this.coverageButton );
   viewRow.addStretch();
   this.resultsGroup = new GroupBox( this );
   this.resultsGroup.title = L( "Résultats et coût des masques", "Results and cost of the masks" );
   this.resultsGroup.sizer = new VerticalSizer;
   this.resultsGroup.sizer.margin = 6;
   this.resultsGroup.sizer.spacing = 4;
   this.resultsGroup.sizer.add( this.summaryLabel );
   this.resultsGroup.sizer.add( viewRow );

   // --- WBPP ----------------------------------------------------------------
   this.wbppLabel = new Label( this );
   this.wbppLabel.useRichText = true;
   this.wbppLabel.wordWrapping = true;
   this.wbppLabel.text = L( "Dans WBPP, Pipeline &gt; Event Script, choisir ce fichier :",
                            "In WBPP, Pipeline &gt; Event Script, select this file:" );
   this.wbppLabel.toolTip = TIPS.wbpp;
   this.wbppEdit = new Edit( this );
   this.wbppEdit.readOnly = true;
   this.wbppEdit.text = EVENT_SCRIPT;
   this.wbppEdit.toolTip = TIPS.wbpp;
   this.wbppGroup = new GroupBox( this );
   this.wbppGroup.title = L( "Avec WBPP", "With WBPP" );
   this.wbppGroup.sizer = new VerticalSizer;
   this.wbppGroup.sizer.margin = 6;
   this.wbppGroup.sizer.spacing = 4;
   this.wbppGroup.sizer.add( this.wbppLabel );
   this.wbppGroup.sizer.add( this.wbppEdit );

   // --- buttons -------------------------------------------------------------
   this.resetButton = new ToolButton( this );
   this.resetButton.icon = this.scaledResource( ":/process-interface/reset.png" );
   this.resetButton.setScaledFixedSize( 24, 24 );
   this.resetButton.toolTip = TIPS.reset;
   this.resetButton.onClick = function() { self.resetSettings(); };
   this.previewButton = new PushButton( this );
   this.previewButton.text = L( "Prévisualiser", "Preview" );
   this.previewButton.toolTip = TIPS.preview;
   this.previewButton.onClick = function() { self.run( true ); };
   this.applyButton = new PushButton( this );
   this.applyButton.text = L( "Appliquer", "Apply" );
   this.applyButton.icon = this.scaledResource( ":/icons/ok.png" );
   this.applyButton.toolTip = TIPS.apply;
   this.applyButton.onClick = function() { self.run( false ); };
   this.stopButton = new PushButton( this );
   this.stopButton.text = L( "Arrêter", "Stop" );
   this.stopButton.toolTip = TIPS.stop;
   this.stopButton.enabled = false;
   this.stopButton.onClick = function()
   {
      self.stopRequested = true;
      self.stopButton.text = L( "Arrêt...", "Stopping..." );
      self.stopButton.enabled = false;
   };
   this.closeButton = new PushButton( this );
   this.closeButton.text = L( "Fermer", "Close" );
   this.closeButton.icon = this.scaledResource( ":/icons/cancel.png" );
   this.closeButton.toolTip = TIPS.close;
   this.closeButton.onClick = function()
   {
      if ( self.running )
         return;
      self.storeState();
      self.ok();
   };
   var buttons = new HorizontalSizer;
   buttons.spacing = 6;
   buttons.add( this.resetButton );
   buttons.addStretch();
   buttons.add( this.previewButton );
   buttons.add( this.applyButton );
   buttons.add( this.stopButton );
   buttons.add( this.closeButton );

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add( topRow );
   this.sizer.add( this.framesGroup, 100 );
   this.sizer.add( this.settingsGroup );
   this.sizer.add( this.resultsGroup );
   this.sizer.add( this.wbppGroup );
   this.sizer.add( buttons );

   this.restoreState();
   this.updateAngleNote();
   this.adjustToContents();
   this.setMinWidth( this.logicalPixelsToPhysical( 820 ) );
}

// --- list ---------------------------------------------------------------------

addPath( path )
{
   for ( var i = 0; i < this.list.numberOfChildren; ++i )
      if ( this.list.child( i ).__path == path )
         return;
   var node = new TreeBoxNode( this.list );
   node.__path = path;
   node.setText( 0, File.extractName( path ) + File.extractExtension( path ) );
   node.setToolTip( 0, path );
   for ( var c = 1; c < 6; ++c ) node.setText( c, "" );
}

addFiles()
{
   var ofd = new OpenFileDialog;
   ofd.caption = L( "Brutes registrées", "Registered frames" );
   ofd.multipleSelections = true;
   ofd.filters = [ [ L( "Images", "Images" ), "*.xisf", "*.fit", "*.fits", "*.fts" ] ];
   var last = readString( "lastFolder", "" );
   if ( last.length > 0 && File.directoryExists( last ) )
      ofd.initialPath = last;
   if ( !ofd.execute() )
      return;
   for ( var i = 0; i < ofd.fileNames.length; ++i )
      this.addPath( ofd.fileNames[i] );
   if ( ofd.fileNames.length > 0 )
   {
      var dir = File.extractDrive( ofd.fileNames[0] ) + File.extractDirectory( ofd.fileNames[0] );
      writeString( "lastFolder", dir );
      if ( this.outputEdit.text.trim().length == 0 )
      {
         this.outputEdit.text = dir + "/ClarkeMask";
         writeString( "outputDir", this.outputEdit.text );
      }
   }
   for ( var c = 0; c < this.list.numberOfColumns; ++c )
      this.list.adjustColumnWidthToContents( c );
}

removeSelected()
{
   for ( var i = this.list.numberOfChildren - 1; i >= 0; --i )
      if ( this.list.child( i ).selected )
         this.list.remove( i );
}

paths()
{
   var p = [];
   for ( var i = 0; i < this.list.numberOfChildren; ++i )
      p.push( this.list.child( i ).__path );
   return p;
}

nodeFor( path )
{
   for ( var i = 0; i < this.list.numberOfChildren; ++i )
      if ( this.list.child( i ).__path == path )
         return this.list.child( i );
   return null;
}

selectedPath()
{
   for ( var i = 0; i < this.list.numberOfChildren; ++i )
      if ( this.list.child( i ).selected )
         return this.list.child( i ).__path;
   return this.list.numberOfChildren == 1 ? this.list.child( 0 ).__path : null;
}

outputDir()
{
   return this.outputEdit.text.trim();
}

// --- state kept between relaunches (language change) ---------------------------

storeState()
{
   ClarkeMaskDialog.state = { paths: this.paths(), summary: this.lastSummary };
}

restoreState()
{
   var s = ClarkeMaskDialog.state;
   if ( !s )
      return;
   for ( var i = 0; i < s.paths.length; ++i )
      this.addPath( s.paths[i] );
   if ( s.summary )
   {
      this.lastSummary = s.summary;
      this.summaryLabel.text = s.summary;
   }
}

// --- processing ---------------------------------------------------------------

setRunning( on )
{
   this.running = on;
   this.previewButton.enabled = !on;
   this.applyButton.enabled = !on;
   this.addButton.enabled = !on;
   this.removeButton.enabled = !on;
   this.clearButton.enabled = !on;
   this.resetButton.enabled = !on;
   this.showButton.enabled = !on;
   this.coverageButton.enabled = !on;
   this.closeButton.enabled = !on;
   this.stopButton.enabled = on;
   this.stopButton.text = L( "Arrêter", "Stop" );
}

run( dryRun )
{
   var self = this, paths = this.paths(), out = this.outputDir();
   if ( paths.length == 0 )
   {
      message( L( "Ajouter d'abord des brutes registrées.", "Add registered frames first." ), StdIcon.Warning );
      return;
   }
   if ( out.length == 0 )
   {
      message( L( "Choisir un dossier de sortie.", "Choose an output folder." ), StdIcon.Warning );
      return;
   }
   writeString( "outputDir", out );
   for ( var i = 0; i < this.list.numberOfChildren; ++i )
      for ( var c = 1; c < 6; ++c ) this.list.child( i ).setText( c, "" );
   this.stopRequested = false;
   this.setRunning( true );
   console.show();
   var lines = [];
   var res = null;
   try
   {
      res = ClarkeMaskEngine.processGroup( paths, {
         dryRun: dryRun,
         outputDir: out,
         copyTo: dryRun ? "" : out,
         noData: this.noDataCombo.currentItem == 1 ? NaN : 0,
         abort: function() { processEvents(); return self.stopRequested; },
         onProgress: function() { processEvents(); },
         onFrame: function( r ) { self.showFrameResult( r, dryRun ); processEvents(); },
         log: function( s )
         {
            lines.push( s );
            console.writeln( "ClarkeMask: " + s );
            console.flush();
            processEvents();
         }
      } );
   }
   catch ( e )
   {
      lines.push( "** " + e.message );
      console.criticalln( "ClarkeMask: " + e.message );
   }
   if ( res )
      for ( var f = 0; f < res.failed.length; ++f )
      {
         var node = this.nodeFor( res.failed[f] );
         if ( node ) node.setText( 5, L( "échec, non modifiée", "failed, untouched" ) );
      }
   try
   {
      if ( !File.directoryExists( out ) ) File.createDirectory( out, true );
      File.writeTextFile( out + "/ClarkeMask.log", lines.join( "\n" ) + "\n" );
   }
   catch ( e ) {}
   this.renderSummary( res, lines, paths.length );
   for ( var col = 0; col < this.list.numberOfColumns; ++col )
      this.list.adjustColumnWidthToContents( col );
   this.setRunning( false );
}

showFrameResult( r, dryRun )
{
   var node = this.nodeFor( r.file );
   if ( !node )
      return;
   var confirmed = 0;
   for ( var i = 0; i < r.detail.trails.length; ++i )
      if ( r.detail.trails[i].confirmedByLength ) ++confirmed;
   node.setText( 1, String( r.trails ) );
   node.setText( 2, String( r.pixels ) );
   node.setText( 3, String( confirmed ) );
   node.setText( 4, String( r.rejected ) );
   node.setText( 5, r.pixels == 0 ? L( "aucune traînée", "no trail" ) :
                    dryRun ? L( "prévisualisée", "previewed" ) : L( "copie écrite", "copy written" ) );
}

renderSummary( res, lines, total )
{
   // Summary in the interface language, from the figures returned by the
   // engine (its log, in English, goes to the console and ClarkeMask.log).
   var out = [], esc = function( t ) { return String( t ).replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ); };
   if ( res && res.results.length > 0 )
   {
      var trails = 0, confirmed = 0, reported = 0;
      for ( var i = 0; i < res.results.length; ++i )
      {
         var r = res.results[i];
         trails += r.trails;
         reported += r.rejected;
         for ( var t = 0; t < r.detail.trails.length; ++t )
            if ( r.detail.trails[t].confirmedByLength ) ++confirmed;
      }
      out.push( "<b>" + L( res.results.length + " brute(s) traitée(s) sur " + total + " : " + trails + " traînée(s) masquée(s), dont " +
                           confirmed + " confirmée(s) par la longueur ; " + reported + " signalée(s) sans être masquée(s).",
                           res.results.length + " of " + total + " frame(s) processed: " + trails + " trail(s) masked, " + confirmed +
                           " of them confirmed by length; " + reported + " reported without being masked." ) + "</b>" );
      var cov = res.coverage;
      if ( cov && cov.field > 0 )
      {
         var N = cov.frames, worst = N - cov.min;
         if ( worst == 0 )
            out.push( L( "Aucun pixel n'a perdu de brute.", "No pixel lost any frame." ) );
         else
            out.push( L( "Pire cas : " + worst + " brute(s) perdue(s) sur " + N + " (pose conservée " + pct( cov.min / N, 0 ) +
                         ", SNR conservé " + pct( Math.sqrt( cov.min / N ), 0 ) + ") sur " + num( cov.lost[worst] ) + " px (" +
                         share( cov.lost[worst] / cov.field ) + " du champ). SNR moyen conservé sur le champ : " + pct( cov.meanSnr, 2 ) + ".",
                         "Worst case: " + worst + " of " + N + " frame(s) lost (exposure kept " + pct( cov.min / N, 0 ) +
                         ", SNR kept " + pct( Math.sqrt( cov.min / N ), 0 ) + ") on " + num( cov.lost[worst] ) + " px (" +
                         share( cov.lost[worst] / cov.field ) + " of the field). Mean SNR kept over the field: " + pct( cov.meanSnr, 2 ) + "." ) );
         for ( var k = 1; k <= N; ++k )
         {
            if ( !cov.lost[k] ) continue;
            var kept = ( N - k ) / N;
            out.push( "&nbsp;&nbsp;" + L( k + " brute(s) perdue(s) : pose " + pct( kept, 0 ) + ", SNR " + pct( Math.sqrt( kept ), 0 ) + ", " +
                                          num( cov.lost[k] ) + " px (" + share( cov.lost[k] / cov.field ) + " du champ)",
                                          k + " frame(s) lost: exposure " + pct( kept, 0 ) + ", SNR " + pct( Math.sqrt( kept ), 0 ) + ", " +
                                          num( cov.lost[k] ) + " px (" + share( cov.lost[k] / cov.field ) + " of the field)" ) );
         }
         if ( cov.low > 0 )
            out.push( "<b>" + L( num( cov.low ) + " px gardent moins de 50 % des brutes.", num( cov.low ) + " px keep less than 50% of the frames." ) + "</b>" );
         out.push( "<i>" + L( "SNR estimé pour des brutes de même poids ; champ = zone couverte par toutes les brutes.",
                              "SNR estimated for equal frame weights; field = area covered by every frame." ) + "</i>" );
      }
      var r0 = res.results[0];
      if ( r0.expectedLength > 0 )
         out.push( L( "Longueur attendue d'une traînée géosynchrone : " + Math.round( r0.expectedLength ) + " px (pose de " + r0.exposure + " s).",
                      "Expected length of a geosynchronous trail: " + Math.round( r0.expectedLength ) + " px (" + r0.exposure + " s exposure)." ) );
   }
   if ( res && res.theta === null )
      out.push( "<b>" + L( "Pas de solution astrométrique : rien n'a été masqué. Résoudre les brutes (WCS écrit à l'acquisition, ou " +
                           "ImageSolver sur la référence) puis relancer. Le plate solving de WBPP ne résout que les masters.",
                           "No astrometric solution: nothing was masked. Plate-solve the frames (WCS written at acquisition, or " +
                           "ImageSolver on the reference), then run again. The plate solving of WBPP only solves the masters." ) + "</b>" );
   if ( res && res.failed.length > 0 && res.theta !== null )
      out.push( "<b>" + L( res.failed.length + " brute(s) laissée(s) intacte(s) après une erreur (voir la console).",
                           res.failed.length + " frame(s) left untouched after an error (see the console)." ) + "</b>" );
   if ( res && res.theta !== null && res.results.length + res.failed.length < total )
      out.push( "<b>" + L( "Arrêté après " + ( res.results.length + res.failed.length ) + " brute(s).",
                           "Stopped after " + ( res.results.length + res.failed.length ) + " frame(s)." ) + "</b>" );
   if ( !res )
      for ( var j = 0; j < lines.length; ++j )
         if ( /^\*\*/.test( lines[j] ) ) out.push( "<b>" + esc( lines[j] ) + "</b>" );
   this.lastSummary = out.length ? "<p>" + out.join( "<br/>" ) + "</p>" : L( "<i>Pas de résultat.</i>", "<i>No result.</i>" );
   this.summaryLabel.text = this.lastSummary;
}

// --- viewing ------------------------------------------------------------------

showSelected()
{
   var path = this.selectedPath();
   if ( !path )
   {
      message( L( "Sélectionner une brute dans la liste.", "Select a frame in the list." ), StdIcon.Warning );
      return;
   }
   var maskPath = this.outputDir() + "/" + File.extractName( path ) + "_mask.xisf";
   if ( !File.exists( maskPath ) )
   {
      message( L( "Pas de masque pour cette brute dans le dossier de sortie (aucune traînée, ou brute pas encore traitée " +
                  "dans ce dossier) :\n", "No mask for this frame in the output folder (no trail, or frame not processed into " +
                  "this folder yet):\n" ) + maskPath, StdIcon.Information );
      return;
   }
   var id = File.extractName( path ).replace( /[^A-Za-z0-9_]/g, "_" );
   if ( !/^[A-Za-z_]/.test( id ) ) id = "_" + id;
   var fw = ImageWindow.open( path, id );
   if ( fw.length < 1 )
   {
      message( L( "Impossible d'ouvrir ", "Cannot open " ) + path, StdIcon.Error );
      return;
   }
   var mw = ImageWindow.open( maskPath, id + "_cmask" );
   if ( mw.length < 1 )
   {
      message( L( "Impossible d'ouvrir ", "Cannot open " ) + maskPath, StdIcon.Error );
      return;
   }
   var frame = fw[0], mask = mw[0];
   applyAutoSTF( frame.mainView );
   frame.mask = mask;
   frame.maskEnabled = true;
   frame.maskVisible = true;
   mask.show();
   frame.show();
   frame.bringToFront();
   frame.zoomToFit();
}

showCoverage()
{
   var path = this.outputDir() + "/coverage.xisf";
   if ( !File.exists( path ) )
   {
      message( L( "Pas de carte de couverture dans le dossier de sortie :\n", "No coverage map in the output folder:\n" ) + path,
               StdIcon.Information );
      return;
   }
   var w = ImageWindow.open( path, "ClarkeMask_coverage" );
   if ( w.length < 1 )
      return;
   applyAutoSTF( w[0].mainView );
   w[0].show();
   w[0].zoomToFit();
}

// --- settings note ----------------------------------------------------------------

updateAngleNote()
{
   // The confirmation by length only acts beyond the maximum angle.
   var on = this.maxConfirmedControl.value <= this.maxAngleControl.value;
   this.angleNote.text = on ? "<i>" + L( "La confirmation par la longueur n'agit qu'au-delà de l'angle maximal : avec ces valeurs, elle " +
                                         "est sans effet.", "The confirmation by length only acts beyond the maximum angle: with these " +
                                         "values it has no effect." ) + "</i>" : "";
   this.angleNote.visible = on;
}

// --- reset ----------------------------------------------------------------------

resetSettings()
{
   removeAllSettings();
   var d = ClarkeMaskCore.DEFAULTS;
   this.maxAngleControl.setValue( d.maxAngle );
   this.maxConfirmedControl.setValue( d.maxConfirmedAngle );
   this.threadsSpin.value = ClarkeMaskEngine.SETTINGS.threads.def;
   this.updateAngleNote();
   this.noDataCombo.currentItem = 0;
   this.outputEdit.text = "";
   console.writeln( TITLE + ": " + L( "réglages remis par défaut (y compris ceux du script d'événement de WBPP).",
                                      "settings reset to defaults (including those of the WBPP event script)." ) );
}
};

ClarkeMaskDialog.state = null;

// ============================================================================
// Entry point
// ============================================================================

function main()
{
   LANG = detectLanguage();
   console.hide();
   for ( ;; )
   {
      TIPS = buildTips();
      var dialog = new ClarkeMaskDialog;
      dialog.execute();
      if ( !dialog.relaunch )
         break;
   }
}

if ( typeof CLARKEMASK_NO_MAIN === "undefined" )
   main();
