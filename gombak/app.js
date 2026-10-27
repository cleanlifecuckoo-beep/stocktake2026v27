
var BUILTIN_COLOR_CODES = JSON.parse(JSON.stringify(COLOR_CODES));

var inv = {};
INVENTORY.forEach(function(item){ inv[item.barcode.trim()] = item; });

/* ── State ──
   qtyCounts: { 'BARCODE::COLORCODE': qty }   e.g. '837017220001::BL01': 3
   historyLog: [{ ts, bc, colorCode, desc, size, oldQty, newQty, type }]
*/
var qtyCounts   = {};
var historyLog  = [];
var recentScans = [];  /* [{ bc, colorCode }] */
var clearing    = false;
var activeBc    = null;
var activeColor = null;  /* currently selected colour for scan */
var invEditBc   = null;
var invEditColor= null;
var invFilterOn = false;
var STORAGE_KEY = window.STORAGE_KEY || 'default';
var COMBO_SEP   = '::';

function makeKey(bc, colorCode){ return bc + COMBO_SEP + (colorCode||'NONE'); }
function splitKey(key){ var p=key.split(COMBO_SEP); return {bc:p[0], colorCode:p[1]==='NONE'?'':p[1]}; }

/* ── Persistence ── */
function saveData(){
  try{
    localStorage.setItem(STORAGE_KEY+'_qty',    JSON.stringify(qtyCounts));
    localStorage.setItem(STORAGE_KEY+'_hist',   JSON.stringify(historyLog.slice(0,2000)));
    localStorage.setItem(STORAGE_KEY+'_recent', JSON.stringify(recentScans.slice(0,30)));
    var l=document.getElementById('sync-lbl');
    if(l){l.textContent='Saved';setTimeout(function(){l.textContent='';},1400);}
  }catch(e){showToast('Storage penuh — export dulu!');}
}
function loadData(){
  try{
    var q=localStorage.getItem(STORAGE_KEY+'_qty');    if(q) qtyCounts  =JSON.parse(q);
    var h=localStorage.getItem(STORAGE_KEY+'_hist');   if(h) historyLog =JSON.parse(h);
    var r=localStorage.getItem(STORAGE_KEY+'_recent'); if(r) recentScans=JSON.parse(r);
  }catch(e){}
  updateStats(); renderRecent();
}
function loadImportedInventory(){
  try{
    var saved=localStorage.getItem(STORAGE_KEY+'_inv');
    if(saved){
      var savedInv=JSON.parse(saved);
      var baseKeys={};
      INVENTORY.forEach(function(i){baseKeys[i.barcode.trim()]=true;});
      savedInv.forEach(function(i){
        var bc=i.barcode.trim();
        if(!baseKeys[bc]){INVENTORY.push(i);inv[bc]=i;}
        else{inv[bc].description=i.description;inv[bc].size=i.size||'';inv[bc].price=i.price;}
      });
    }
  }catch(e){}
}

/* ── Helpers ── */
function showToast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2200);
}
function fmtTime(ts){
  var d=new Date(ts);
  return d.toLocaleDateString('en-MY',{day:'2-digit',month:'short'})+' '+
         d.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'});
}
function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function findItem(raw){
  if(!raw) return null;
  var t=raw.trim().replace(/^\t+|\t+$/g,'');
  if(!t) return null;
  if(inv[t])              return {key:t,item:inv[t]};
  var u=t.toUpperCase();
  if(inv[u])              return {key:u,item:inv[u]};
  var s=t.replace(/\s+/g,'').toUpperCase();
  if(inv[s])              return {key:s,item:inv[s]};
  return null;
}

/* ── Colour helpers ── */
function getColorHex(code){
  if(!code||code==='NONE') return '#e5e5e5';
  var c=COLOR_CODES[code.toUpperCase()];
  if(c) return c.hex;
  if(/^#[0-9a-fA-F]{3,6}$/.test(code)) return code;
  return '#7c3aed';
}
function getColorName(code){
  if(!code||code==='NONE') return 'Tiada warna';
  var c=COLOR_CODES[code.toUpperCase()];
  return c ? code.toUpperCase()+' '+c.name : code;
}
function isLightColor(code){
  var hex=getColorHex(code).replace('#','');
  if(hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r=parseInt(hex.substr(0,2),16),g=parseInt(hex.substr(2,2),16),b=parseInt(hex.substr(4,2),16);
  return (r*299+g*587+b*114)/1000>155;
}

/* ── Colour picker ── */
function openColorPicker(onPick, currentCode){
  var existing=document.getElementById('color-picker-overlay');
  if(existing){existing.remove();return;}

  var overlay=document.createElement('div');
  overlay.id='color-picker-overlay';
  overlay.className='color-picker-overlay';
  overlay.onclick=function(e){if(e.target===overlay)overlay.remove();};

  var box=document.createElement('div');
  box.className='color-picker-box';

  /* Header */
  var hdr=document.createElement('div');hdr.className='color-picker-hdr';
  var hdrSpan=document.createElement('span');hdrSpan.textContent='Pilih Warna';
  var hdrClose=document.createElement('button');hdrClose.innerHTML='&#10005;';
  hdrClose.onclick=function(){overlay.remove();};
  hdr.appendChild(hdrSpan);hdr.appendChild(hdrClose);
  box.appendChild(hdr);

  /* Clear button */
  var clearBtn=document.createElement('button');
  clearBtn.className='color-clear-btn';
  clearBtn.textContent='Tiada Warna';
  clearBtn.onclick=function(){if(onPick) onPick('');overlay.remove();};
  box.appendChild(clearBtn);

  /* ── Add New Colour Form ── */
  var addSection=document.createElement('div');
  addSection.style.cssText='padding:8px 16px 4px;border-bottom:1px solid #f3f4f6;';

  var addToggle=document.createElement('button');
  addToggle.className='add-new-color-btn';
  addToggle.innerHTML='&#43; Tambah Warna Baru';
  addSection.appendChild(addToggle);

  var addForm=document.createElement('div');
  addForm.className='add-color-form';
  addForm.style.display='none';

  /* Colour name input */
  var nameWrap=document.createElement('div');nameWrap.className='add-color-row';
  var nameLbl=document.createElement('label');nameLbl.textContent='Nama Warna';nameLbl.className='add-color-lbl';
  var nameInp=document.createElement('input');
  nameInp.type='text';nameInp.className='add-color-name-inp';
  nameInp.placeholder='cth: Dusty Lavender, Teal Mist...';
  nameInp.autocomplete='off';nameInp.spellcheck=false;
  nameWrap.appendChild(nameLbl);nameWrap.appendChild(nameInp);
  addForm.appendChild(nameWrap);

  /* Family selector */
  var famWrap=document.createElement('div');famWrap.className='add-color-row';
  var famLbl=document.createElement('label');famLbl.textContent='Keluarga';famLbl.className='add-color-lbl';
  var famSel=document.createElement('select');famSel.className='add-color-select';
  Object.keys(COLOR_FAMILIES).forEach(function(fam){
    var opt=document.createElement('option');
    opt.value=fam;opt.textContent=fam+' — '+COLOR_FAMILIES[fam];
    famSel.appendChild(opt);
  });
  /* Custom family option */
  var customOpt=document.createElement('option');
  customOpt.value='XX';customOpt.textContent='XX — Custom (lain-lain)';
  famSel.appendChild(customOpt);
  famWrap.appendChild(famLbl);famWrap.appendChild(famSel);
  addForm.appendChild(famWrap);

  /* Colour picker (native) + hex input */
  var colorWrap=document.createElement('div');colorWrap.className='add-color-row';
  var colorLbl=document.createElement('label');colorLbl.textContent='Warna';colorLbl.className='add-color-lbl';
  var colorRow=document.createElement('div');colorRow.style.cssText='display:flex;gap:8px;align-items:center;flex:1;';
  var nativePicker=document.createElement('input');
  nativePicker.type='color';nativePicker.value='#3B82F6';nativePicker.className='native-color-picker';
  var hexInp=document.createElement('input');
  hexInp.type='text';hexInp.className='add-color-hex-inp';hexInp.value='#3B82F6';hexInp.placeholder='#RRGGBB';
  hexInp.maxLength=7;
  /* Sync native picker <-> hex input */
  nativePicker.oninput=function(){hexInp.value=nativePicker.value;};
  hexInp.oninput=function(){
    if(/^#[0-9a-fA-F]{6}$/.test(hexInp.value)) nativePicker.value=hexInp.value;
  };
  colorRow.appendChild(nativePicker);colorRow.appendChild(hexInp);
  colorWrap.appendChild(colorLbl);colorWrap.appendChild(colorRow);
  addForm.appendChild(colorWrap);

  /* Save new colour button */
  var saveNewBtn=document.createElement('button');
  saveNewBtn.className='add-color-save-btn';
  saveNewBtn.textContent='Simpan & Pilih Warna Ini';
  saveNewBtn.onclick=function(){
    var name=nameInp.value.trim();
    var hex=hexInp.value.trim();
    var fam=famSel.value;
    if(!name){nameInp.style.borderColor='#ef4444';nameInp.focus();return;}
    if(!/^#[0-9a-fA-F]{6}$/.test(hex)){hexInp.style.borderColor='#ef4444';hexInp.focus();return;}
    /* Check duplicate name */
    var dupName=Object.values(COLOR_CODES).find(function(c){return c.name.toLowerCase()===name.toLowerCase();});
    if(dupName){showToast('Nama warna sudah ada!');return;}
    /* Generate next code in family */
    var maxNum=0;
    Object.keys(COLOR_CODES).forEach(function(code){
      if(code.indexOf(fam)===0){
        var n=parseInt(code.slice(fam.length));
        if(!isNaN(n)&&n>maxNum) maxNum=n;
      }
    });
    var newCode=fam+(maxNum+1<10?'0'+(maxNum+1):''+(maxNum+1));
    /* Handle collision */
    while(COLOR_CODES[newCode]){maxNum++;newCode=fam+(maxNum+1<10?'0'+(maxNum+1):''+(maxNum+1));}
    /* Add to COLOR_CODES */
    COLOR_CODES[newCode]={name:name,hex:hex};
    /* Persist custom colors to localStorage */
    saveCustomColors();
    showToast(newCode+' '+name+' ditambah!');
    /* Auto-select the new colour and close */
    if(onPick) onPick(newCode);
    overlay.remove();
  };
  addForm.appendChild(saveNewBtn);

  addToggle.onclick=function(){
    var showing=addForm.style.display!=='none';
    addForm.style.display=showing?'none':'block';
    addToggle.innerHTML=showing?'&#43; Tambah Warna Baru':'&#8722; Tutup';
    if(!showing) setTimeout(function(){nameInp.focus();},100);
  };

  addSection.appendChild(addForm);
  box.appendChild(addSection);

  /* ── Colour swatches (scrollable) ── */
  var scroll=document.createElement('div');
  scroll.className='color-picker-scroll';

  Object.keys(COLOR_FAMILIES).concat(['XX']).forEach(function(famCode){
    var famName=famCode==='XX'?'Custom':COLOR_FAMILIES[famCode];
    var codesInFam=Object.keys(COLOR_CODES).filter(function(code){return code.indexOf(famCode)===0;});
    if(!codesInFam.length) return;  /* skip empty families */

    var famDiv=document.createElement('div');famDiv.className='color-family';
    var famTitle=document.createElement('div');famTitle.className='color-family-title';
    famTitle.textContent=famName+' ('+famCode+')';
    famDiv.appendChild(famTitle);

    var grid=document.createElement('div');grid.className='color-grid';
    codesInFam.forEach(function(code){
      var data=COLOR_CODES[code];
      var swatch=document.createElement('div');
      swatch.className='color-swatch'+(currentCode&&currentCode.toUpperCase()===code?' selected':'');
      swatch.title=code+' - '+data.name;
      var dot=document.createElement('div');dot.className='swatch-dot';dot.style.background=data.hex;
      /* White border for light colours */
      if(isLightColor(code)) dot.style.border='1.5px solid #d1d5db';
      var lbl=document.createElement('div');lbl.className='swatch-lbl';lbl.textContent=code;
      var lbl2=document.createElement('div');lbl2.className='swatch-name';lbl2.textContent=data.name;
      swatch.appendChild(dot);swatch.appendChild(lbl);swatch.appendChild(lbl2);
      swatch.onclick=function(){if(onPick) onPick(code);overlay.remove();};
      grid.appendChild(swatch);
    });

    famDiv.appendChild(grid);scroll.appendChild(famDiv);
  });

  box.appendChild(scroll);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/* ── Custom colour persistence ── */
function saveCustomColors(){
  try{
    var custom={};
    Object.keys(COLOR_CODES).forEach(function(code){
      /* Save codes that aren't in the original built-in set */
      if(!BUILTIN_COLOR_CODES[code]) custom[code]=COLOR_CODES[code];
    });
    localStorage.setItem(STORAGE_KEY+'_custom_colors', JSON.stringify(custom));
  }catch(e){}
}
function loadCustomColors(){
  try{
    var saved=localStorage.getItem(STORAGE_KEY+'_custom_colors');
    if(saved){
      var custom=JSON.parse(saved);
      Object.keys(custom).forEach(function(code){
        COLOR_CODES[code]=custom[code];
      });
      if(Object.keys(custom).length) console.log('Loaded',Object.keys(custom).length,'custom colours');
    }
  }catch(e){}
}

/* ── Barcode input ── */
var barcodeInput=document.getElementById('barcode-input');
var manualDebounce;
barcodeInput.addEventListener('keydown',function(e){
  if(e.key==='Enter'){
    clearTimeout(manualDebounce);
    var raw=barcodeInput.value.trim();
    if(raw) processScan(raw);
    e.preventDefault();
  }
});
barcodeInput.addEventListener('input',function(){
  if(clearing) return;
  clearTimeout(manualDebounce);
  var raw=barcodeInput.value.trim();
  if(!raw) return;
  manualDebounce=setTimeout(function(){
    raw=barcodeInput.value.trim();
    if(raw) processScan(raw);
  },500);
});

/* ── Scan flow ──
   Step 1: barcode scanned → show item + colour selector
   Step 2: user picks colour → Save button becomes active
   Step 3: save → records barcode+colour combo
*/
function processScan(raw){
  var found=findItem(raw);
  if(found){
    activeBc=found.key;
    activeColor=null;  /* reset colour for each new scan */
    showResult(found.key, found.item, false);
    clearing=true;
    barcodeInput.value='';
    barcodeInput.classList.remove('not-found');
    setTimeout(function(){clearing=false;barcodeInput.focus();},50);
  }else{
    activeBc=null;activeColor=null;
    showNotFound(raw);
    barcodeInput.classList.add('not-found');
    setTimeout(function(){barcodeInput.classList.remove('not-found');},1500);
  }
}

function showNotFound(raw){
  document.getElementById('result-area').innerHTML=
    '<div class="result-card notfound">'+
      '<div class="result-bc">'+escHtml(raw)+'</div>'+
      '<div class="result-name" style="color:#dc2626">Barcode tidak dalam inventory</div>'+
      '<div class="result-price">Semak barcode dan cuba lagi</div>'+
    '</div>';
}

function showResult(bc, item, colorRequired){
  var el=document.getElementById('result-area');
  var colorCode=activeColor||'';
  var colorHex=colorCode?getColorHex(colorCode):'#f3f4f6';
  var colorLabel=colorCode?getColorName(colorCode):'Tap untuk pilih warna...';
  var existingQty=colorCode?( qtyCounts[makeKey(bc,colorCode)]||0 ) : 0;

  el.innerHTML=
    '<div class="result-card found">'+
      '<div class="result-bc">'+escHtml(bc)+'</div>'+
      '<div class="result-name">'+escHtml(item.description)+'</div>'+
      (item.size?'<div class="result-size">Saiz: '+escHtml(item.size)+'</div>':'')+
      '<div class="result-price">RM '+item.price.toFixed(2)+'</div>'+
      (colorRequired?'<div class="color-required-hint show">&#9888; Sila pilih warna dahulu</div>':'<div class="color-required-hint"></div>')+
      '<div class="color-options-row">'+
      '<div class="color-select-row'+(colorCode?' color-chosen':activeColor===null?'':' no-color-chosen')+'" onclick="pickScanColor()">'+
        '<div class="color-select-dot" style="background:'+colorHex+'"></div>'+
        '<div class="color-select-label'+(colorCode?' chosen':(activeColor===''?' chosen-none':''))+'">'+(activeColor===''?'Tiada Warna':escHtml(colorLabel))+'</div>'+
        '<div class="color-select-arrow">&#9660;</div>'+
      '</div>'+
      '<button class="no-color-btn'+(activeColor===''?' active':'')+'" onclick="setNoColor()">Tiada Warna</button>'+
    '</div>'+
      '<div class="qty-controls">'+
        '<button class="qty-btn" onclick="adjustActive(-1)">&#8722;</button>'+
        '<input class="qty-input" type="number" id="active-qty" min="0" value="'+(existingQty+1)+'" />'+
        '<button class="qty-btn" onclick="adjustActive(1)">+</button>'+
        '<button class="save-btn'+(activeColor!==null?'':' need-color')+'" id="active-save" onclick="saveActive()">'+
          (activeColor!==null?'Save':'Pilih Warna / Tiada Warna')+
        '</button>'+
      '</div>'+
    '</div>';
}


function setNoColor(){
  if(!isUnlocked){ promptUnlock(setNoColor); return; }
  activeColor = '';  /* explicit no-colour selection */
  var item = inv[activeBc];
  if(item) showResult(activeBc, item, false);
}

function pickScanColor(){
  if(!isUnlocked){ promptUnlock(pickScanColor); return; }
  openColorPicker(function(code){
    activeColor=code||null;
    var item=inv[activeBc];
    if(item) showResult(activeBc,item,false);
  }, activeColor);
}

function adjustActive(d){
  var inp=document.getElementById('active-qty');
  if(!inp) return;
  inp.value=Math.max(0,(parseInt(inp.value,10)||0)+d);
}

function saveActive(){
  if(!isUnlocked){ promptUnlock(saveActive); return; }
  if(!activeBc){showToast('Tiada item');return;}
  /* activeColor can be '' (no colour) — that's valid, saves as BARCODE::NONE */
  var inp=document.getElementById('active-qty');
  var newQty=Math.max(0,parseInt(inp?inp.value:1,10)||1);
  var key=makeKey(activeBc,activeColor);
  var oldQty=qtyCounts[key]||0;
  qtyCounts[key]=newQty;
  var item=inv[activeBc];
  historyLog.unshift({ts:Date.now(),bc:activeBc,colorCode:activeColor,
    desc:item?item.description:activeBc,size:item?item.size||'':'',
    oldQty:oldQty,newQty:newQty,type:'scan'});
  recentScans=[{bc:activeBc,colorCode:activeColor}].concat(
    recentScans.filter(function(r){return !(r.bc===activeBc&&r.colorCode===activeColor);})).slice(0,30);
  saveData();updateStats();renderRecent();
  var btn=document.getElementById('active-save');
  if(btn){btn.textContent='Saved \u2713';btn.classList.add('saved');}
  showToast(getColorName(activeColor)+' \u2192 '+newQty+' unit');
}

/* ── Stats ── */
function updateStats(){
  var total=0,skus=new Set(),colors=0;
  Object.keys(qtyCounts).forEach(function(key){
    var v=qtyCounts[key];
    if(v>0){
      total+=v;
      var p=splitKey(key);
      skus.add(p.bc);
      colors++;
    }
  });
  document.getElementById('s-total').textContent=total;
  document.getElementById('s-skus').textContent=skus.size;
  document.getElementById('s-colors').textContent=colors;
}

/* ── Recent list ── */
function renderRecent(){
  var el=document.getElementById('recent-section');
  if(!recentScans.length){el.innerHTML='<div class="empty-state">Belum ada scan<br>Scan barcode kat atas untuk mula</div>';return;}
  var html='';
  recentScans.forEach(function(r){
    var item=inv[r.bc];if(!item) return;
    var key=makeKey(r.bc,r.colorCode);
    var qty=qtyCounts[key]||0;
    var colorHex=getColorHex(r.colorCode);
    var colorName=getColorName(r.colorCode);
    html+='<div class="item-group" onclick="tapRecent(\''+escHtml(r.bc)+'\',\''+escHtml(r.colorCode||'')+'\')">'+
      '<div class="item-group-header">'+
        '<div class="item-group-left">'+
          '<div class="item-group-bc">'+escHtml(r.bc)+'</div>'+
          '<div class="item-group-name">'+escHtml(item.description)+'</div>'+
          (item.size?'<div class="item-group-size">'+escHtml(item.size)+'</div>':'')+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<div style="width:16px;height:16px;border-radius:50%;background:'+colorHex+';border:1.5px solid rgba(0,0,0,0.1)"></div>'+
          '<div class="item-group-total">'+qty+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="padding:2px 16px 8px 32px;font-size:12px;color:#7c3aed;font-weight:600">'+escHtml(colorName)+'</div>'+
    '</div>';
  });
  el.innerHTML=html;
}

function tapRecent(bc,colorCode){
  activeBc=bc;activeColor=colorCode||null;
  var item=inv[bc];
  if(item) showResult(bc,item,false);
}

/* ── Group counts by barcode ── */
function getGroupedCounts(){
  var groups={};
  Object.keys(qtyCounts).forEach(function(key){
    var qty=qtyCounts[key];if(!qty) return;
    var p=splitKey(key);
    if(!groups[p.bc]) groups[p.bc]={bc:p.bc,colors:{}};
    groups[p.bc].colors[p.colorCode||'NONE']=qty;
  });
  return groups;
}

/* ── Counted tab ── */
function renderCounted(){
  var el=document.getElementById('counted-list');
  var q=(document.getElementById('counted-search').value||'').toLowerCase();
  var groups=getGroupedCounts();
  var bcs=Object.keys(groups).filter(function(bc){
    if(!inv[bc]) return false;
    if(!q) return true;
    return bc.toLowerCase().indexOf(q)>=0||inv[bc].description.toLowerCase().indexOf(q)>=0;
  });
  bcs.sort(function(a,b){
    var ta=Object.values(groups[a].colors).reduce(function(x,y){return x+y;},0);
    var tb=Object.values(groups[b].colors).reduce(function(x,y){return x+y;},0);
    return tb-ta;
  });
  if(!bcs.length){el.innerHTML='<div class="empty-state">'+(q?'Tiada item dijumpai':'Belum ada item dikira')+'</div>';return;}
  el.innerHTML=bcs.map(function(bc){return renderGroupHtml(bc,groups[bc].colors,'tapCountedColor');}).join('');
}

function tapCountedColor(bc,colorCode){
  activeBc=bc;activeColor=colorCode||null;
  switchTab('scan');
  var item=inv[bc];if(item) showResult(bc,item,false);
}

/* ── Inventory tab ── */
function renderInventory(forceAll){
  var el=document.getElementById('inv-list');
  var q=(document.getElementById('inv-search').value||'').toLowerCase();
  var rows=INVENTORY;
  if(q) rows=rows.filter(function(i){
    return i.barcode.toLowerCase().indexOf(q)>=0||
           i.description.toLowerCase().indexOf(q)>=0||
           (i.size&&i.size.toLowerCase().indexOf(q)>=0);
  });
  if(invFilterOn) rows=rows.filter(function(i){
    return Object.keys(qtyCounts).some(function(k){return k.indexOf(i.barcode.trim()+COMBO_SEP)===0&&qtyCounts[k]>0;});
  });
  if(!rows.length){el.innerHTML='<div class="empty-state">'+(q||invFilterOn?'Tiada item dijumpai':'Tiada inventory')+'</div>';return;}
  var PAGE=80;
  var showAll=forceAll||q||invFilterOn||rows.length<=PAGE;
  var visible=showAll?rows:rows.slice(0,PAGE);
  var groups=getGroupedCounts();
  var html=visible.map(function(item){
    var bc=item.barcode.trim();
    var colors=groups[bc]?groups[bc].colors:{};
    return renderGroupHtml(bc,colors,'tapInvColor',item);
  }).join('');
  if(!showAll&&rows.length>PAGE){
    html+='<div style="padding:16px;text-align:center">'+
      '<button onclick="renderInventory(true)" style="height:44px;padding:0 24px;border-radius:10px;border:2px solid #e5e5e5;background:#fff;font-size:14px;font-weight:600;color:#1a1a1a;cursor:pointer">'+
      'Tunjuk semua '+rows.length.toLocaleString()+' item</button>'+
      '<div style="font-size:12px;color:#9ca3af;margin-top:6px">Menunjukkan '+PAGE+' item pertama</div>'+
    '</div>';
  }
  el.innerHTML=html;
}

function renderGroupHtml(bc,colors,tapFn,itemOverride){
  var item=itemOverride||inv[bc];if(!item) return '';
  var totalQty=Object.values(colors).reduce(function(a,b){return a+b;},0);
  var colorEntries=Object.keys(colors).filter(function(c){return colors[c]>0;});
  var html='<div class="item-group">'+
    '<div class="item-group-header" onclick="toggleGroup(\''+escHtml(bc)+'\')">'+
      '<div class="item-group-left">'+
        '<div class="item-group-bc">'+escHtml(bc)+'</div>'+
        '<div class="item-group-name">'+escHtml(item.description)+'</div>'+
        (item.size?'<div class="item-group-size">'+escHtml(item.size)+'</div>':'')+
        '<div class="item-group-price">RM '+item.price.toFixed(2)+'</div>'+
      '</div>'+
      '<div class="item-group-total">'+totalQty+'</div>'+
    '</div>'+
    '<div class="color-rows" id="grp-'+escHtml(bc)+'">';

  colorEntries.forEach(function(colorCode){
    var qty=colors[colorCode];
    var realCode=colorCode==='NONE'?'':colorCode;
    var hex=getColorHex(realCode);
    var name=getColorName(realCode);
    html+='<div class="color-row" onclick="'+tapFn+'(\''+escHtml(bc)+'\',\''+escHtml(realCode)+'\')">'+
      '<div class="color-row-dot" style="background:'+hex+'"></div>'+
      '<div class="color-row-name">'+escHtml(name)+'</div>'+
      '<div class="color-row-code">'+escHtml(colorCode==='NONE'?'-':colorCode)+'</div>'+
      '<div class="color-row-qty">'+qty+'</div>'+
      '<div class="color-row-edit">&#9998;</div>'+
    '</div>';
  });

  /* Add new colour button */
  html+='<div class="add-color-btn" onclick="addColorToItem(\''+escHtml(bc)+'\')">'+
    '<span>+</span><span>Tambah warna</span></div>';

  html+='</div></div>';
  return html;
}

function toggleGroup(bc){
  var el=document.getElementById('grp-'+bc);
  if(el) el.style.display=el.style.display==='none'?'':'none';
}

function tapInvColor(bc,colorCode){
  activeBc=bc;activeColor=colorCode||null;
  switchTab('scan');
  var item=inv[bc];if(item) showResult(bc,item,false);
}

function addColorToItem(bc){
  if(!isUnlocked){ promptUnlock(function(){addColorToItem(bc);}); return; }
  activeBc=bc;activeColor=null;
  switchTab('scan');
  var item=inv[bc];if(item) showResult(bc,item,false);
}

function toggleInvFilter(){
  invFilterOn=!invFilterOn;
  var btn=document.getElementById('inv-filter-btn');
  btn.classList.toggle('active-filter',invFilterOn);
  btn.textContent=invFilterOn?'Semua':'Counted';
  renderInventory();
}

/* ── History tab ── */
function renderHistory(){
  var el=document.getElementById('hist-list');
  var q=(document.getElementById('hist-search').value||'').toLowerCase();
  var rows=historyLog;
  if(q) rows=rows.filter(function(h){
    return h.bc.toLowerCase().indexOf(q)>=0||h.desc.toLowerCase().indexOf(q)>=0||
           (h.colorCode&&h.colorCode.toLowerCase().indexOf(q)>=0);
  });
  if(!rows.length){el.innerHTML='<div class="empty-state">Belum ada perubahan direkod</div>';return;}
  var html='';
  rows.forEach(function(h){
    var diff=h.newQty-h.oldQty,badge;
    if(h.type==='scan')  badge='<span class="badge scan">scan</span>';
    else if(diff>0)      badge='<span class="badge inc">+'+diff+'</span>';
    else if(diff<0)      badge='<span class="badge dec">'+diff+'</span>';
    else                 badge='<span class="badge set">set</span>';
    var colorHex=getColorHex(h.colorCode||'');
    var colorName=getColorName(h.colorCode||'');
    html+='<div class="hist-row">'+
      '<div class="hist-top"><div class="hist-name">'+escHtml(h.desc)+(h.size?'<span style="font-size:11px;color:#2563eb;font-weight:600;margin-left:6px">'+escHtml(h.size)+'</span>':'')+'</div>'+
      '<div class="hist-time">'+fmtTime(h.ts)+'</div></div>'+
      '<div class="hist-bc">'+escHtml(h.bc)+'</div>'+
      (h.colorCode?'<div class="hist-color"><div class="hist-color-dot" style="background:'+colorHex+'"></div><div class="hist-color-name">'+escHtml(colorName)+'</div></div>':'')+
      '<div class="hist-detail">'+badge+' <span>'+h.oldQty+' \u2192 '+h.newQty+'</span></div>'+
    '</div>';
  });
  el.innerHTML=html;
}

/* ── Tab switching ── */

/* ═══════════════════════════════════════════════
   MANUAL ADD NEW ITEM
   ═══════════════════════════════════════════════ */
function openAddItemModal() {
  if(!isUnlocked){ promptUnlock(openAddItemModal); return; }
  if (document.getElementById('add-item-overlay')) {
    document.getElementById('add-item-overlay').remove(); return;
  }
  var overlay = document.createElement('div');
  overlay.id = 'add-item-overlay';
  overlay.className = 'backup-modal-overlay';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };

  overlay.innerHTML =
    '<div class="backup-modal">' +
      '<div class="backup-modal-hdr">' +
        '<span>&#43; Tambah Item Baru</span>' +
        '<button onclick="document.getElementById(\'add-item-overlay\').remove()">&#10005;</button>' +
      '</div>' +
      '<div class="backup-section">' +

        '<div class="add-item-row">' +
          '<label class="add-item-lbl">Barcode <span style="color:#ef4444">*</span></label>' +
          '<input id="new-item-bc" type="text" class="add-item-inp" ' +
            'placeholder="cth: 8888001234567" ' +
            'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/>' +
          '<div class="add-item-hint" id="bc-hint"></div>' +
        '</div>' +

        '<div class="add-item-row">' +
          '<label class="add-item-lbl">Nama Item <span style="color:#ef4444">*</span></label>' +
          '<input id="new-item-desc" type="text" class="add-item-inp" ' +
            'placeholder="cth: BAJU MELAYU COTTON" autocomplete="off" spellcheck="false"/>' +
        '</div>' +

        '<div class="add-item-row">' +
          '<label class="add-item-lbl">Saiz</label>' +
          '<input id="new-item-size" type="text" class="add-item-inp" ' +
            'placeholder="cth: S, M, L, XL, 38..." autocomplete="off" spellcheck="false"/>' +
        '</div>' +

        '<div class="add-item-row">' +
          '<label class="add-item-lbl">Harga (RM)</label>' +
          '<input id="new-item-price" type="number" class="add-item-inp" ' +
            'placeholder="cth: 49.90" min="0" step="0.01"/>' +
        '</div>' +

        '<button class="backup-action-btn primary" style="width:100%;margin-top:8px" ' +
          'onclick="saveNewItem()">&#10003; Simpan Item</button>' +

        '<div style="margin-top:10px;font-size:12px;color:#9ca3af;text-align:center">' +
          'Item baru akan terus boleh discan selepas disimpan' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  var bcInp = document.getElementById('new-item-bc');
  if (bcInp) {
    bcInp.addEventListener('input', function(){
      var val = this.value.trim();
      var hint = document.getElementById('bc-hint');
      if (!hint) return;
      if (!val) { hint.textContent=''; hint.className='add-item-hint'; return; }
      var existing = inv[val] || inv[val.toUpperCase()];
      if (existing) {
        hint.textContent = '\u26a0 Dah wujud: ' + existing.description;
        hint.className = 'add-item-hint warn';
      } else {
        hint.textContent = '\u2713 Barcode baru';
        hint.className = 'add-item-hint ok';
      }
    });
    setTimeout(function(){ bcInp.focus(); }, 200);
  }
}

function saveNewItem() {
  if(!isUnlocked){ promptUnlock(saveNewItem); return; }
  var bcEl    = document.getElementById('new-item-bc');
  var descEl  = document.getElementById('new-item-desc');
  var sizeEl  = document.getElementById('new-item-size');
  var priceEl = document.getElementById('new-item-price');

  var bc    = bcEl    ? bcEl.value.trim().replace(/^\t+|\t+$/g,'') : '';
  var desc  = descEl  ? descEl.value.trim()  : '';
  var size  = sizeEl  ? sizeEl.value.trim()  : '';
  var price = priceEl ? parseFloat(priceEl.value)||0 : 0;

  if (!bc)   { showToast('Barcode wajib diisi!');   if(bcEl)   bcEl.focus();   return; }
  if (!desc) { showToast('Nama item wajib diisi!'); if(descEl) descEl.focus(); return; }

  var existing = inv[bc] || inv[bc.toUpperCase()];
  if (existing) {
    if (!confirm('Barcode sudah wujud untuk "' + existing.description + '".\nGanti maklumat item ini?')) return;
    existing.description = desc;
    existing.size        = size;
    existing.price       = price;
    showToast('Item dikemaskini \u2713');
  } else {
    var newItem = { barcode: bc, description: desc, size: size, price: price };
    inv[bc] = newItem;
    INVENTORY.push(newItem);
    showToast('Item baru ditambah \u2713');
  }

  try { localStorage.setItem(STORAGE_KEY + '_inv', JSON.stringify(INVENTORY)); } catch(e){}

  var ov = document.getElementById('add-item-overlay');
  if (ov) ov.remove();

  renderInventory();

  /* Jump to scan with new barcode pre-loaded */
  activeBc = bc;
  activeColor = null;
  switchTab('scan');
  var item = inv[bc];
  if (item) showResult(bc, item, 0, true);
}

function updateModeBanner(tabName, salesTypeOverride){
  var banner = document.getElementById('mode-banner');
  if(!banner) return;
  var t = salesTypeOverride || salesType;
  if(tabName === 'scan'){
    banner.className = 'mode-banner mode-count';
    banner.innerHTML = '&#9650; MOD KIRAAN STOK';
  } else if(tabName === 'sales' && t === 'sale'){
    banner.className = 'mode-banner mode-sales';
    banner.innerHTML = '&#128178; MOD JUALAN — QTY AKAN DITOLAK';
  } else if(tabName === 'sales' && t === 'transfer'){
    banner.className = 'mode-banner mode-transfer';
    banner.innerHTML = '&#8644; MOD PINDAHAN — QTY AKAN DITOLAK';
  } else {
    banner.className = 'mode-banner mode-count';
    banner.innerHTML = '';
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
}

function switchTab(name){
  var tabs=['scan','inventory','counted','history','import','sales'];
  tabs.forEach(function(t,i){
    document.getElementById('tab-'+t).classList.toggle('active',t===name);
    document.querySelectorAll('.tab')[i].classList.toggle('active',t===name);
  });
  if(name==='inventory') renderInventory();
  if(name==='counted')   renderCounted();
  if(name==='history')   renderHistory();
  if(name==='sales')     renderSalesLog();
  if(name==='scan')      setTimeout(function(){barcodeInput.focus();},50);
  updateModeBanner(name);
}

/* ── Export ── */
function buildExportData(){
  /* One row per barcode+colour combo */
  var countRows=[['Barcode','Description','Size','Colour Code','Colour Name','Price (RM)','Qty']];
  INVENTORY.forEach(function(item){
    var bc=item.barcode.trim();
    /* Find all colour entries for this barcode */
    var found=false;
    Object.keys(qtyCounts).forEach(function(key){
      if(key.indexOf(bc+COMBO_SEP)===0&&qtyCounts[key]>0){
        var p=splitKey(key);
        var colorCode=p.colorCode||'';
        countRows.push([bc,item.description,item.size||'',colorCode,
          colorCode?getColorName(colorCode):'',item.price,qtyCounts[key]]);
        found=true;
      }
    });
    if(!found) countRows.push([bc,item.description,item.size||'','','',item.price,0]);
  });

  var histRows=[['Timestamp','Barcode','Description','Size','Colour Code','Colour Name','Old Qty','New Qty','Change','Type']];
  historyLog.forEach(function(h){
    var price=inv[h.bc]?inv[h.bc].price:'';
    var colorCode=h.colorCode||'';
    histRows.push([fmtTime(h.ts),h.bc,h.desc,h.size||'',colorCode,
      colorCode?getColorName(colorCode):'',h.oldQty,h.newQty,h.newQty-h.oldQty,h.type]);
  });
  return {countRows:countRows,histRows:histRows};
}

function exportXLSX(source){
  if(typeof XLSX==='undefined'){showToast('Library tidak loaded');return;}
  var data=buildExportData(),wb=XLSX.utils.book_new(),dateStr=new Date().toISOString().slice(0,10);
  var ws1=XLSX.utils.aoa_to_sheet(data.countRows);
  ws1['!cols']=[{wch:18},{wch:38},{wch:10},{wch:10},{wch:16},{wch:12},{wch:8}];
  ws1['!freeze']={xSplit:0,ySplit:1};
  ws1['!autofilter']={ref:'A1:G'+data.countRows.length};
  XLSX.utils.book_append_sheet(wb,ws1,'Stock Count');
  var ws2=XLSX.utils.aoa_to_sheet(data.histRows);
  ws2['!cols']=[{wch:18},{wch:16},{wch:34},{wch:8},{wch:10},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8}];
  ws2['!freeze']={xSplit:0,ySplit:1};
  XLSX.utils.book_append_sheet(wb,ws2,'Change History');
  var fname = source==='cloud-backup'
    ? 'BACKUP_'+window.BRANCH_SLUG+'_'+dateStr+'.xlsx'
    : 'Stocktake_'+window.BRANCH_SLUG+'_'+dateStr+'.xlsx';
  XLSX.writeFile(wb, fname);
  if(source==='cloud-backup'){
    showToast('Cloud sync + Excel backup berjaya ✓');
  } else {
    showToast('Excel downloaded!');
  }
}
function exportCSV(){
  var data=buildExportData();
  var csv='\uFEFF'+data.countRows.map(function(r){
    return r.map(function(c){var s=String(c===null||c===undefined?'':c);
      return s.indexOf(',')>=0||s.indexOf('"')>=0?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(',');
  }).join('\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='Stocktake_'+window.BRANCH_SLUG+'_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  showToast('CSV downloaded');
}

/* ── Import ── */
var pendingImport=null;
function handleDragOver(e){e.preventDefault();document.getElementById('import-drop-zone').classList.add('drag-over');}
function handleDragLeave(){document.getElementById('import-drop-zone').classList.remove('drag-over');}
function handleDrop(e){e.preventDefault();document.getElementById('import-drop-zone').classList.remove('drag-over');var f=e.dataTransfer.files;if(f.length>0)processImportFile(f[0]);}
function handleFileSelect(e){var f=e.target.files;if(f.length>0)processImportFile(f[0]);e.target.value='';}
function processImportFile(file){
  var name=file.name.toLowerCase();
  var isExcel=name.endsWith('.xlsx')||name.endsWith('.xls'),isCSV=name.endsWith('.csv');
  if(!isExcel&&!isCSV){showToast('Format tidak disokong');return;}
  showToast('Membaca fail...');
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var items=isCSV?parseCSVImport(e.target.result):parseExcelImport(new Uint8Array(e.target.result));
      if(!items.length){showToast('Tiada item dijumpai');return;}
      var newItems=[],updatedItems=[],sameItems=[];
      items.forEach(function(item){
        var bc=item.barcode;
        if(!inv[bc]) newItems.push(item);
        else if(inv[bc].description!==item.description||inv[bc].price!==item.price) updatedItems.push(item);
        else sameItems.push(item);
      });
      pendingImport=items;
      document.getElementById('prev-filename').textContent=file.name;
      document.getElementById('prev-total').textContent=items.length;
      document.getElementById('prev-new').textContent=newItems.length;
      document.getElementById('prev-updated').textContent=updatedItems.length;
      document.getElementById('prev-same').textContent=sameItems.length;
      document.getElementById('import-preview').style.display='block';
      var btn=document.getElementById('import-confirm-btn');
      btn.classList.add('ready');
      btn.textContent='\u2705 Sahkan & Import ('+(newItems.length+updatedItems.length)+' perubahan)';
      var logEl=document.getElementById('import-log'),logHtml='';
      newItems.slice(0,30).forEach(function(i){logHtml+='<div class="import-log-row added">+ '+i.barcode+' \u2014 '+i.description+'</div>';});
      logEl.innerHTML=logHtml;logEl.style.display=logHtml?'block':'none';
    }catch(err){showToast('Ralat: '+err.message);}
  };
  if(isCSV) reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}
function parseExcelImport(data){
  var wb=XLSX.read(data,{type:'array'});
  var ws=wb.Sheets[wb.SheetNames[0]];
  return parseRowsImport(XLSX.utils.sheet_to_json(ws,{header:1,defval:''}));
}
function parseRowsImport(rows){
  if(!rows.length) return [];
  var hi=-1,cB=-1,cD=-1,cS=-1,cP=-1,cCC=-1,cQTY=-1;
  for(var r=0;r<Math.min(5,rows.length);r++){
    var row=rows[r].map(function(c){return String(c).trim().toUpperCase();});
    var bi=row.findIndex(function(c){return c==='BARCODE'||c==='BAR CODE';});
    if(bi>=0){
      hi=r; cB=bi;
      cD  =row.findIndex(function(c){return c.indexOf('DESCRIPTION')>=0;});
      cS  =row.findIndex(function(c){return c==='SIZE'||c==='SAIZ';});
      cP  =row.findIndex(function(c){return c.indexOf('PRICE')>=0||c==='HARGA';});
      cCC =row.findIndex(function(c){return c==='COLOUR CODE'||c==='COLOR CODE'||c==='COLOUR'||c==='COLOR';});
      cQTY=row.findIndex(function(c){return c==='QTY'||c==='QUANTITY'||c==='JUMLAH';});
      break;
    }
  }
  if(hi<0) throw new Error('Kolum BARCODE tidak dijumpai. Pastikan baris pertama ada header.');

  var isStocktakeExport=(cCC>=0 && cQTY>=0);
  var items=[];
  for(var i=hi+1;i<rows.length;i++){
    var row=rows[i];
    var bc=String(row[cB]||'').trim().replace(/^\t+|\t+$/g,'');
    if(!bc) continue;
    var desc  = cD>=0  ? String(row[cD]||'').trim()   : '';
    var size  = cS>=0  ? String(row[cS]||'').trim()   : '';
    var price = cP>=0  ? parseFloat(row[cP])||0       : 0;
    var cc    = cCC>=0 ? String(row[cCC]||'').trim()  : '';
    var qty   = cQTY>=0? parseInt(row[cQTY],10)||0    : 0;
    items.push({barcode:bc, description:desc, size:size, price:price,
                colourCode:cc, qty:qty, isStocktakeExport:isStocktakeExport});
  }
  return items;
}
function parseCSVImport(text){
  var lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  return parseRowsImport(lines.map(function(line){
    var result=[],cur='',inQ=false;
    for(var c=0;c<line.length;c++){
      if(line[c]==='"'){inQ=!inQ;}
      else if(line[c]===','&&!inQ){result.push(cur);cur='';}
      else{cur+=line[c];}
    }result.push(cur);return result;
  }));
}
function confirmImport(){
  if(!isUnlocked){ promptUnlock(confirmImport); return; }
  if(!pendingImport) return;
  var isStocktake = pendingImport.length > 0 && pendingImport[0].isStocktakeExport;

  if(isStocktake){
    /* ── Stocktake export restore: update inventory + counts + colours ── */
    var invAdded=0, invUpdated=0, qtyRestored=0, colorsRestored=0;

    pendingImport.forEach(function(item){
      var bc = item.barcode;

      /* 1. Update inventory */
      if(!inv[bc]){
        var newItem={barcode:bc,description:item.description,size:item.size||'',price:item.price};
        inv[bc]=newItem; INVENTORY.push(newItem); invAdded++;
      } else {
        if(item.description) inv[bc].description=item.description;
        if(item.size)        inv[bc].size=item.size;
        if(item.price)       inv[bc].price=item.price;
        invUpdated++;
      }

      /* 2. Restore qty count (barcode::colourCode key) */
      if(item.qty > 0){
        var key = makeKey(bc, item.colourCode||'');
        var existing = qtyCounts[key]||0;
        /* Take the higher value (don't overwrite more recent scans) */
        qtyCounts[key] = Math.max(existing, item.qty);
        qtyRestored++;
      }

      /* 3. Restore custom colour if it's not in our COLOR_CODES */
      if(item.colourCode && !COLOR_CODES[item.colourCode]){
        /* Look it up from export name — store as custom */
        COLOR_CODES[item.colourCode]={name:item.colourCode, hex:'#7c3aed'};
        colorsRestored++;
      }
    });

    /* Persist */
    try{localStorage.setItem(STORAGE_KEY+'_inv', JSON.stringify(INVENTORY));}catch(e){}
    saveData();
    updateStats();
    renderRecent();

    var msg='\u2705 Data dipulihkan! '+qtyRestored+' count, '+invAdded+' item baru'+
      (colorsRestored?' + '+colorsRestored+' warna custom':'')+'!';
    document.getElementById('import-log').innerHTML='<div class="import-log-row added">'+msg+'</div>';
    document.getElementById('import-log').style.display='block';
    showToast(msg);

  } else {
    /* ── Inventory-only import: add/update items only ── */
    var added=0, updated=0;
    pendingImport.forEach(function(item){
      var bc=item.barcode;
      if(!inv[bc]){inv[bc]=item;INVENTORY.push(item);added++;}
      else{inv[bc].description=item.description;inv[bc].size=item.size||'';inv[bc].price=item.price;updated++;}
    });
    try{localStorage.setItem(STORAGE_KEY+'_inv',JSON.stringify(INVENTORY));}catch(e){}
    document.getElementById('import-log').innerHTML='<div class="import-log-row added">\u2705 Selesai! '+added+' item baru, '+updated+' dikemaskini.</div>';
    document.getElementById('import-log').style.display='block';
    showToast('\u2705 '+added+' baru, '+updated+' dikemaskini!');
  }

  pendingImport=null;
  document.getElementById('import-confirm-btn').style.display='none';
}

/* ── Init ── */
document.getElementById('topbar-date').textContent=
  new Date().toLocaleDateString('en-MY',{day:'numeric',month:'long',year:'numeric'});
loadCustomColors();
/* ═══════════════════════════════════════════════════════════════
   BACKUP & CLOUD SYNC SYSTEM
   ═══════════════════════════════════════════════════════════════ */

var JSONBIN_API = 'https://api.jsonbin.io/v3/b';
var JSONBIN_KEY = localStorage.getItem('jsonbin_master_key') || '';
var lastSyncTime = 0;

/* ── Serialise / deserialise all app data ── */
function getDataPayload() {
  return {
    version: 2,
    branch: window.BRANCH_SLUG,
    ts: Date.now(),
    qtyCounts: qtyCounts,
    historyLog: historyLog.slice(0, 500),
    recentScans: recentScans,
    customColors: (function(){
      var c={};
      Object.keys(COLOR_CODES).forEach(function(k){
        if(!BUILTIN_COLOR_CODES[k]) c[k]=COLOR_CODES[k];
      });
      return c;
    })()
  };
}

function applyDataPayload(payload) {
  if (!payload || payload.version !== 2) return false;
  /* Merge qty counts — on PULL, cloud is the master combined total
     (it already contains all team members' contributions via READ+ADD sync).
     Take the cloud value directly as the ground truth. */
  Object.keys(payload.qtyCounts || {}).forEach(function(k) {
    qtyCounts[k] = payload.qtyCounts[k] || 0;
  });
  /* Snapshot so next push only sends new scans made after this pull */
  try { localStorage.setItem(STORAGE_KEY+'_last_synced_qty', JSON.stringify(qtyCounts)); } catch(e){}
  /* Merge history — combine and deduplicate by timestamp */
  var existingTs = new Set(historyLog.map(function(h) { return h.ts; }));
  (payload.historyLog || []).forEach(function(h) {
    if (!existingTs.has(h.ts)) historyLog.push(h);
  });
  historyLog.sort(function(a, b) { return b.ts - a.ts; });
  historyLog = historyLog.slice(0, 1000);
  /* Merge custom colors */
  Object.keys(payload.customColors || {}).forEach(function(k) {
    COLOR_CODES[k] = payload.customColors[k];
  });
  return true;
}

/* ── BACKUP CODE (offline) ── */
function generateBackupCode() {
  var payload = getDataPayload();
  var json = JSON.stringify(payload);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  return b64;
}

function restoreFromBackupCode(code) {
  try {
    var json = decodeURIComponent(escape(atob(code.trim().replace(/\s+/g,''))));
    var payload = JSON.parse(json);
    if (applyDataPayload(payload)) {
      saveData();
      updateStats();
      renderRecent();
      return true;
    }
    return false;
  } catch(e) {
    return false;
  }
}

/* ── CLOUD SYNC via JSONBin.io ── */
function getSyncPin() {
  return localStorage.getItem(STORAGE_KEY + '_sync_pin') || '';
}
function setSyncPin(pin) {
  localStorage.setItem(STORAGE_KEY + '_sync_pin', pin);
}


function openApiKeyModal() {
  if (document.getElementById('apikey-modal-overlay')) return;
  var savedKey = localStorage.getItem('jsonbin_master_key') || '';
  var overlay = document.createElement('div');
  overlay.id = 'apikey-modal-overlay';
  overlay.className = 'backup-modal-overlay';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };

  overlay.innerHTML =
    '<div class="backup-modal">' +
      '<div class="backup-modal-hdr">' +
        '<span>&#9729; Setup Cloud Sync</span>' +
        '<button onclick="document.getElementById(\'apikey-modal-overlay\').remove()">&#10005;</button>' +
      '</div>' +
      '<div class="backup-section">' +
        '<div class="backup-section-title">Langkah 1 — Daftar JSONBin.io (percuma)</div>' +
        '<div class="backup-section-desc">' +
          '1. Pergi ke <b>jsonbin.io</b> dalam browser<br>' +
          '2. Klik <b>Sign Up</b> (guna email atau Google)<br>' +
          '3. Log in &rarr; klik nama anda di atas kanan<br>' +
          '4. Pilih <b>API Keys</b><br>' +
          '5. Klik <b>Create Master Key</b> &rarr; salin key tersebut' +
        '</div>' +
        '<div class="backup-section-title" style="margin-top:12px">Langkah 2 — Masukkan API Key</div>' +
        '<div class="backup-section-desc">Paste key yang disalin di sini:</div>' +
        '<input id="apikey-input" type="text" placeholder="$2a$10$xxxxxxxxxxxxxxxxxxxx..." ' +
          'style="width:100%;height:44px;border-radius:10px;border:2px solid #e5e5e5;' +
          'background:#fafafa;font-size:12px;font-family:monospace;padding:0 12px;' +
          'color:#1a1a1a;outline:none;margin-bottom:10px;box-sizing:border-box" ' +
          'value="' + savedKey + '" />' +
        '<button class="backup-action-btn primary" style="width:100%" onclick="saveApiKey()">Simpan &amp; Sambung</button>' +
        (savedKey ?
          '<div style="font-size:12px;color:#16a34a;margin-top:8px;text-align:center">&#10003; API Key sudah tersimpan</div>' : '') +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  setTimeout(function(){ var inp=document.getElementById('apikey-input'); if(inp) inp.focus(); }, 200);
}

function saveApiKey() {
  var inp = document.getElementById('apikey-input');
  if (!inp) return;
  var key = inp.value.trim();
  if (!key) { showToast('Sila masukkan API Key'); return; }
  if (!key.startsWith('$2a$')) {
    showToast('Format key tidak sah. Mestilah bermula dengan $2a$');
    return;
  }
  localStorage.setItem('jsonbin_master_key', key);
  JSONBIN_KEY = key;
  document.getElementById('apikey-modal-overlay').remove();
  showToast('API Key disimpan! Tekan Simpan ke Cloud sekarang.');
}


function pushToCloud(onDone) {
  if(!isUnlocked){ promptUnlock(function(){ pushToCloud(onDone); }); return; }
  var key = JSONBIN_KEY || localStorage.getItem('jsonbin_master_key') || '';
  if (!key) { showToast('Sila setup API Key dulu'); openApiKeyModal(); return; }
  var pin = getSyncPin();
  showToast('Menyimpan ke cloud...');

  if (!pin) {
    /* ── First sync: create new bin ── */
    var payload = JSON.stringify(getDataPayload());
    fetch(JSONBIN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': key,
        'X-Bin-Name':   'stocktake-' + window.BRANCH_SLUG + '-' + Date.now(),
        'X-Bin-Private':'false'
      },
      body: payload
    })
    .then(function(r){
      if(r.status===401) throw new Error('API Key tidak sah. Semak semula.');
      if(r.status===403) throw new Error('API Key tidak dibenarkan.');
      if(!r.ok) throw new Error('Server error: '+r.status);
      return r.json();
    })
    .then(function(data){
      if(data.metadata && data.metadata.id){
        var binId=data.metadata.id;
        setSyncPin(binId);
        lastSyncTime=Date.now();
        localStorage.setItem(STORAGE_KEY+'_last_sync', lastSyncTime);
        showToast('Berjaya! PIN: '+binId.slice(-8).toUpperCase());
        if(onDone) onDone(binId);
        updateSyncStatus();
        setTimeout(function(){ exportXLSX('cloud-backup'); }, 800);
      } else {
        showToast('Gagal: '+JSON.stringify(data).slice(0,60));
      }
    })
    .catch(function(e){ showToast(e.message||'Gagal sambung ke cloud.'); });

  } else {
    /* ── Subsequent sync: READ cloud first, MERGE, then WRITE ──
       This prevents team members overwriting each other's data.
       Rule: for each barcode+colour key, take the HIGHEST qty.
    */
    fetch(JSONBIN_API+'/'+pin+'/latest', {
      headers: { 'X-Master-Key': key }
    })
    .then(function(r){
      if(r.status===401) throw new Error('API Key tidak sah.');
      if(r.status===404) throw new Error('PIN tidak dijumpai. Cipta PIN baru.');
      if(!r.ok) throw new Error('Server error: '+r.status);
      return r.json();
    })
    .then(function(data){
      /* Merge cloud data into local before pushing */
      if(data.record && data.record.version===2){
        var cloudPayload = data.record;
        var merged = false;

        /* ── READ + ADD merge ──
           Each team member may scan the same SKU in different areas.
           Cloud qty + local qty = real total (never overwrite, always add).
           We track what was already synced to avoid double-adding on
           repeated syncs from the same device.
        */
        var lastSyncedQty = JSON.parse(localStorage.getItem(STORAGE_KEY+'_last_synced_qty')||'{}');

        Object.keys(cloudPayload.qtyCounts||{}).forEach(function(k){
          var cloudQty = cloudPayload.qtyCounts[k] || 0;
          var localQty = qtyCounts[k] || 0;
          /* How many did THIS device contribute last time it synced? */
          var myLastContrib = lastSyncedQty[k] || 0;
          /* Cloud already includes our previous contribution.
             New total = cloudQty + (localQty - myLastContrib)
             i.e. cloud total + any NEW scans we did since last sync */
          var myNewScans = Math.max(0, localQty - myLastContrib);
          var newTotal   = cloudQty + myNewScans;
          if(newTotal !== localQty){
            qtyCounts[k] = newTotal;
            merged = true;
          }
        });

        /* Also add keys that are local but not yet in cloud */
        Object.keys(qtyCounts).forEach(function(k){
          if(!(k in (cloudPayload.qtyCounts||{}))){
            /* This key is new from our device — cloud will get it on write */
            merged = true;
          }
        });

        /* Merge history: add cloud entries not already in local */
        var localTs = {};
        historyLog.forEach(function(h){ localTs[h.ts] = true; });
        var newEntries = (cloudPayload.historyLog||[]).filter(function(h){
          return !localTs[h.ts];
        });
        if(newEntries.length > 0){
          historyLog = historyLog.concat(newEntries);
          historyLog.sort(function(a,b){return b.ts-a.ts;});
          historyLog = historyLog.slice(0,1000);
          merged = true;
        }

        /* Merge custom colours */
        Object.keys(cloudPayload.customColors||{}).forEach(function(k){
          if(!COLOR_CODES[k]){
            COLOR_CODES[k]=cloudPayload.customColors[k];
            merged = true;
          }
        });

        if(merged){
          /* Save merged local data first */
          saveData();
          updateStats();
        }
      }

      /* Now push the merged local data up */
      var mergedPayload = JSON.stringify(getDataPayload());
      return fetch(JSONBIN_API+'/'+pin, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': key
        },
        body: mergedPayload
      });
    })
    .then(function(r){
      if(!r || !r.ok) throw new Error('Gagal tulis ke cloud.');
      return r.json();
    })
    .then(function(data){
      if(data.metadata){
        lastSyncTime=Date.now();
        localStorage.setItem(STORAGE_KEY+'_last_sync', lastSyncTime);
        /* Snapshot our current qty as "last synced" so next sync
           only adds NEW scans, not the full local count again */
        localStorage.setItem(STORAGE_KEY+'_last_synced_qty', JSON.stringify(qtyCounts));
        showToast('Sync berjaya \u2713 (data digabung + tambah)');
        if(onDone) onDone(pin);
        updateSyncStatus();
        renderRecent();
        setTimeout(function(){ exportXLSX('cloud-backup'); }, 800);
      } else {
        showToast('Gagal: '+JSON.stringify(data).slice(0,60));
      }
    })
    .catch(function(e){ showToast(e.message||'Gagal sambung. Semak internet.'); });
  }
}



function pullFromCloud(pinInput, onDone) {
  if(!isUnlocked){ promptUnlock(function(){ pullFromCloud(pinInput,onDone); }); return; }
  var key = JSONBIN_KEY || localStorage.getItem('jsonbin_master_key') || '';
  if (!key) {
    showToast('Sila setup API Key dulu');
    openApiKeyModal();
    return;
  }
  var pin = pinInput || getSyncPin();
  if (!pin) { showToast('Tiada PIN. Tekan "Simpan ke Cloud" dulu.'); return; }
  showToast('Memuat dari cloud...');
  fetch(JSONBIN_API + '/' + pin + '/latest', {
    headers: { 'X-Master-Key': key }
  })
  .then(function(r) {
    if (r.status === 401) throw new Error('API Key tidak sah.');
    if (r.status === 404) throw new Error('PIN tidak dijumpai. Semak semula.');
    if (!r.ok) throw new Error('Server error: ' + r.status);
    return r.json();
  })
  .then(function(data) {
    if (data.record) {
      if (applyDataPayload(data.record)) {
        setSyncPin(pin);
        lastSyncTime = Date.now();
        localStorage.setItem(STORAGE_KEY + '_last_sync', lastSyncTime);
        saveData(); updateStats(); renderRecent();
        showToast('Data dipulihkan dari cloud \u2713');
        if (onDone) onDone();
        updateSyncStatus();
      } else {
        showToast('Format data tidak sah.');
      }
    } else {
      showToast('PIN tidak dijumpai atau kosong.');
    }
  })
  .catch(function(e) {
    showToast(e.message || 'Gagal sambung. Semak internet dan PIN.');
  });
}


function updateSyncStatus() {
  var lbl = document.getElementById('sync-lbl');
  if (!lbl) return;
  var pin = getSyncPin();
  var ts  = localStorage.getItem(STORAGE_KEY + '_last_sync');
  if (pin && ts) {
    var d = new Date(parseInt(ts));
    lbl.textContent = 'Synced ' + d.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'});
  }
}

function checkCloudOnLoad() {
  updateSyncStatus();
  /* If we have a PIN but no local data, offer to pull */
  var pin = getSyncPin();
  var hasData = Object.keys(qtyCounts).length > 0;
  if (pin && !hasData) {
    showRecoveryBanner();
  }
}

/* ── RECOVERY BANNER (shown when no local data but PIN exists) ── */
function showRecoveryBanner() {
  if (document.getElementById('recovery-banner')) return;
  var banner = document.createElement('div');
  banner.id = 'recovery-banner';
  banner.className = 'recovery-banner';
  banner.innerHTML =
    '<div class="recovery-icon">&#9729;</div>' +
    '<div class="recovery-msg"><b>Data tidak dijumpai</b><br>Anda ada cloud sync. Pulihkan sekarang?</div>' +
    '<div class="recovery-btns">' +
      '<button class="recovery-btn-yes" onclick="pullFromCloud(null,function(){document.getElementById(\'recovery-banner\').remove();})">Pulihkan</button>' +
      '<button class="recovery-btn-no" onclick="document.getElementById(\'recovery-banner\').remove()">Tak perlu</button>' +
    '</div>';
  document.querySelector('.app').insertBefore(banner, document.querySelector('.tab-row').nextSibling);
}

/* ── BACKUP REMINDER (shown when app loses focus) ── */
var lastReminderShown = 0;
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    var now = Date.now();
    var hasData = Object.keys(qtyCounts).length > 0;
    /* Show reminder if: has data, not shown in last 5 mins */
    if (hasData && (now - lastReminderShown) > 300000) {
      lastReminderShown = now;
      showBackupReminder();
    }
  }
});

function showBackupReminder() {
  if (document.getElementById('backup-reminder')) return;
  var el = document.createElement('div');
  el.id = 'backup-reminder';
  el.className = 'backup-reminder';
  el.innerHTML =
    '<div class="backup-reminder-top">' +
      '<span>&#9888; Jangan lupa backup data!</span>' +
      '<button onclick="document.getElementById(\'backup-reminder\').remove()">&#10005;</button>' +
    '</div>' +
    '<div class="backup-reminder-btns">' +
      '<button onclick="exportXLSX();document.getElementById(\'backup-reminder\').remove()">&#8659; Export Excel</button>' +
      '<button onclick="pushToCloud(function(){document.getElementById(\'backup-reminder\').remove();})">&#9729; Sync Cloud</button>' +
      '<button onclick="openBackupModal()">&#128190; Backup Code</button>' +
    '</div>';
  document.body.appendChild(el);
  /* Auto-dismiss after 15 seconds */
  setTimeout(function() {
    var r = document.getElementById('backup-reminder');
    if (r) r.remove();
  }, 15000);
}

/* ── BACKUP/SYNC MODAL ── */
function openBackupModal() {
  if (document.getElementById('backup-modal-overlay')) return;
  var pin = getSyncPin();
  var ts  = localStorage.getItem(STORAGE_KEY + '_last_sync');
  var lastSync = ts ? new Date(parseInt(ts)).toLocaleString('en-MY') : 'Belum pernah';

  var overlay = document.createElement('div');
  overlay.id = 'backup-modal-overlay';
  overlay.className = 'backup-modal-overlay';
  overlay.onclick = function(e) { if(e.target===overlay) overlay.remove(); };

  overlay.innerHTML =
    '<div class="backup-modal">' +
      '<div class="backup-modal-hdr">' +
        '<span>&#128274; Backup & Sync</span>' +
        '<button onclick="document.getElementById(\'backup-modal-overlay\').remove()">&#10005;</button>' +
      '</div>' +

      /* Cloud sync section */
      '<div class="backup-section">' +
        '<div class="backup-section-title">&#9729; Cloud Sync</div>' +
        '<div class="backup-section-desc">Simpan data ke cloud. Guna PIN yang sama untuk pulihkan di telefon lain.</div>' +
        (!localStorage.getItem('jsonbin_master_key') ? '<div class="api-key-warning">&#9888; API Key belum disediakan. <button class="api-key-setup-btn" onclick="openApiKeyModal()">Setup Sekarang</button></div>' : '') +
        (pin ?
          '<div class="backup-pin-display">PIN Anda: <b>' + pin.slice(-8).toUpperCase() + '</b> <button onclick="copyPin()">&#128203; Salin</button></div>' +
          '<div style="font-size:12px;color:#9ca3af;margin-bottom:10px">Sync terakhir: ' + lastSync + '</div>' :
          '<div style="font-size:12px;color:#9ca3af;margin-bottom:10px">Belum pernah sync. Tekan butang di bawah untuk cipta PIN baru.</div>') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="backup-action-btn primary" onclick="pushToCloud(null)">&#8679; Simpan ke Cloud</button>' +
          '<button class="backup-action-btn" onclick="openPullModal()">&#8681; Pulihkan</button>' +
        '</div>' +
        '<button class="reset-pin-btn" onclick="resetPin()">&#8635; Lupa PIN? Cipta PIN Baru</button>' + +
      '</div>' +

      /* Backup code section */
      '<div class="backup-section">' +
        '<div class="backup-section-title">&#128190; Backup Code</div>' +
        '<div class="backup-section-desc">Jana kod backup. Screenshot atau WhatsApp kod ini kepada diri sendiri.</div>' +
        '<button class="backup-action-btn primary" onclick="showBackupCode()" style="margin-bottom:8px">Jana Backup Code</button>' +
        '<div id="backup-code-area" style="display:none">' +
          '<textarea id="backup-code-text" class="backup-code-textarea" readonly></textarea>' +
          '<button class="backup-action-btn" onclick="copyBackupCode()">&#128203; Salin Kod</button>' +
        '</div>' +
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6">' +
          '<div class="backup-section-title">&#8679; Restore dari Backup Code</div>' +
          '<textarea id="restore-code-text" class="backup-code-textarea" placeholder="Paste backup code di sini..."></textarea>' +
          '<button class="backup-action-btn primary" onclick="doRestoreCode()">Restore</button>' +
        '</div>' +
      '</div>' +

    '</div>';

  document.body.appendChild(overlay);
}

function copyPin() {
  var pin = getSyncPin();
  if (pin && navigator.clipboard) {
    navigator.clipboard.writeText(pin.slice(-8).toUpperCase()).then(function(){showToast('PIN disalin!');});
  }
}

function showBackupCode() {
  var code = generateBackupCode();
  var area = document.getElementById('backup-code-area');
  var txt  = document.getElementById('backup-code-text');
  if (area && txt) {
    txt.value = code;
    area.style.display = 'block';
  }
}

function copyBackupCode() {
  var txt = document.getElementById('backup-code-text');
  if (txt && navigator.clipboard) {
    navigator.clipboard.writeText(txt.value).then(function(){showToast('Kod disalin! Paste di telefon baru.');});
  } else if (txt) {
    txt.select();
    document.execCommand('copy');
    showToast('Kod disalin!');
  }
}

function doRestoreCode() {
  var txt = document.getElementById('restore-code-text');
  if (!txt || !txt.value.trim()) { showToast('Sila paste backup code dulu.'); return; }
  if (restoreFromBackupCode(txt.value)) {
    showToast('Data berjaya dipulihkan! ✓');
    document.getElementById('backup-modal-overlay').remove();
  } else {
    showToast('Kod tidak sah. Semak semula.');
  }
}


function resetPin(){
  var pin = getSyncPin();
  if(!pin){
    showToast('Tiada PIN lama. Tekan "Simpan ke Cloud" untuk cipta PIN baru.');
    var ov=document.getElementById('backup-modal-overlay');
    if(ov) ov.remove();
    setTimeout(openBackupModal, 300);
    return;
  }
  if(Object.keys(qtyCounts).length > 0){
    var msg = 'AMARAN: Cipta PIN baru bermakna anda tidak boleh sambung ke cloud lama.\n\n'+
              'Pastikan anda dah export Excel dulu sebagai backup.\n\n'+
              'Teruskan cipta PIN baru?';
    if(!confirm(msg)) return;
    exportXLSX('cloud-backup');
    setTimeout(function(){
      localStorage.removeItem(STORAGE_KEY + '_sync_pin');
      localStorage.removeItem(STORAGE_KEY + '_last_sync');
      var ov=document.getElementById('backup-modal-overlay');
      if(ov) ov.remove();
      setTimeout(function(){
        openBackupModal();
        showToast('PIN lama dipadam. Tekan Simpan ke Cloud untuk cipta PIN baru.');
      },300);
    },1000);
  } else {
    localStorage.removeItem(STORAGE_KEY + '_sync_pin');
    localStorage.removeItem(STORAGE_KEY + '_last_sync');
    var ov=document.getElementById('backup-modal-overlay');
    if(ov) ov.remove();
    setTimeout(function(){
      openBackupModal();
      showToast('PIN dipadam. Tekan Simpan ke Cloud untuk cipta PIN baru.');
    },300);
  }
}

function openPullModal() {
  var pin = getSyncPin();
  if (pin) {
    if (confirm('Pulihkan data dari cloud? Data semasa akan digabungkan.')) {
      pullFromCloud(pin, null);
    }
  } else {
    var entered = prompt('Masukkan PIN cloud sync (8 aksara):');
    if (entered && entered.trim()) {
      /* Try to find full bin ID — if user enters short PIN, search */
      pullFromCloud(entered.trim(), null);
    }
  }
}



/* ═══════════════════════════════════════════════
   PIN LOCK SYSTEM
   ═══════════════════════════════════════════════ */

var DEFAULT_PIN = '1234';   /* Default PIN — change after first login */
var MAX_ATTEMPTS = 5;
var LOCKOUT_DURATION = 5 * 60 * 1000; /* 5 minutes */
var isUnlocked = false;

/* Simple hash — XOR + sum based, good enough for local PIN */
function hashPin(pin) {
  var h = 0;
  for (var i = 0; i < pin.length; i++) {
    h = ((h << 5) - h) + pin.charCodeAt(i);
    h = h & h;
  }
  return 'pin_' + Math.abs(h).toString(36);
}

function getStoredHash() {
  return localStorage.getItem(STORAGE_KEY + '_pin_hash') ||
         hashPin(DEFAULT_PIN);
}

function getAttempts() {
  return parseInt(localStorage.getItem(STORAGE_KEY + '_pin_attempts') || '0');
}

function getLockoutTime() {
  return parseInt(localStorage.getItem(STORAGE_KEY + '_pin_lockout') || '0');
}

function isLockedOut() {
  var lockout = getLockoutTime();
  if (!lockout) return false;
  if (Date.now() < lockout) return true;
  /* Lockout expired — reset */
  localStorage.removeItem(STORAGE_KEY + '_pin_lockout');
  localStorage.setItem(STORAGE_KEY + '_pin_attempts', '0');
  return false;
}

function checkPin(pin) {
  return hashPin(pin) === getStoredHash();
}

function recordFailedAttempt() {
  var attempts = getAttempts() + 1;
  localStorage.setItem(STORAGE_KEY + '_pin_attempts', attempts);
  if (attempts >= MAX_ATTEMPTS) {
    var lockUntil = Date.now() + LOCKOUT_DURATION;
    localStorage.setItem(STORAGE_KEY + '_pin_lockout', lockUntil);
    localStorage.setItem(STORAGE_KEY + '_pin_attempts', '0');
  }
  return attempts;
}

function clearAttempts() {
  localStorage.removeItem(STORAGE_KEY + '_pin_attempts');
  localStorage.removeItem(STORAGE_KEY + '_pin_lockout');
}

/* ── Read-only banner ── */
function showReadOnlyBanner(){
  var existing = document.getElementById('readonly-banner');
  if (existing) return;
  var banner = document.createElement('div');
  banner.id = 'readonly-banner';
  banner.className = 'readonly-banner';
  banner.innerHTML =
    '<span>&#128274; Mod Baca Sahaja</span>' +
    '<button onclick="promptUnlock(null)" class="unlock-btn">Unlock untuk Edit</button>';
  var app = document.querySelector('.app');
  var tabRow = app ? app.querySelector('.tab-row') : null;
  if (tabRow && tabRow.nextSibling) {
    app.insertBefore(banner, tabRow.nextSibling);
  } else if (app) {
    app.appendChild(banner);
  }
}

function hideReadOnlyBanner(){
  var banner = document.getElementById('readonly-banner');
  if (banner) banner.remove();
}

/* ── PIN prompt overlay (shown when edit attempted) ── */
function promptUnlock(onSuccess){
  if (isUnlocked){ if(onSuccess) onSuccess(); return; }
  if (document.getElementById('pin-prompt-overlay')) return;

  var overlay = document.createElement('div');
  overlay.id = 'pin-prompt-overlay';
  overlay.className = 'pin-prompt-overlay';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };

  var branchName = window.BRANCH_SLUG.replace(/-/g,' ').toUpperCase();
  overlay.innerHTML =
    '<div class="pin-prompt-box">' +
      '<div class="lock-icon">&#128274;</div>' +
      '<div class="lock-branch">' + branchName + '</div>' +
      '<div class="lock-subtitle">Masukkan PIN untuk edit</div>' +
      '<div class="lock-dots" id="lock-dots">' +
        '<div class="lock-dot" id="dot-0"></div>' +
        '<div class="lock-dot" id="dot-1"></div>' +
        '<div class="lock-dot" id="dot-2"></div>' +
        '<div class="lock-dot" id="dot-3"></div>' +
      '</div>' +
      '<div class="lock-error" id="lock-error"></div>' +
      '<div class="lock-keypad">' +
        [1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(function(k){
          if(k==='') return '<div class="lock-key empty"></div>';
          return '<button class="lock-key" data-key="' + k + '" onclick="lockKeyPress(this.getAttribute(\'data-key\'))">' + k + '</button>';
        }).join('') +
      '</div>' +
      '<button onclick="document.getElementById(\'pin-prompt-overlay\').remove()" ' +
        'style="margin-top:14px;background:none;border:none;color:#6b7280;font-size:13px;cursor:pointer">Batal</button>' +
    '</div>';

  document.body.appendChild(overlay);
  pendingUnlockCallback = onSuccess || null;
}

var pendingUnlockCallback = null;

var lockEntry = '';

function disableLockKeypad(disabled) {
  var keys = document.querySelectorAll('.lock-key');
  keys.forEach(function(k){ k.disabled = disabled; k.style.opacity = disabled?'0.4':'1'; });
}

function lockKeyPress(key) {
  if (isLockedOut()) return;
  if (key === '\u232b' || key === '⌫') {
    lockEntry = lockEntry.slice(0, -1);
  } else if (lockEntry.length < 4) {
    lockEntry += key;
  }
  updateLockDots();
  if (lockEntry.length === 4) {
    setTimeout(verifyPin, 100);
  }
}

function updateLockDots() {
  for (var i = 0; i < 4; i++) {
    var dot = document.getElementById('dot-' + i);
    if (dot) dot.classList.toggle('filled', i < lockEntry.length);
  }
}

function verifyPin() {
  if (checkPin(lockEntry)) {
    /* Correct */
    clearAttempts();
    isUnlocked = true;
    lockEntry = '';
    var overlay = document.getElementById('pin-prompt-overlay');
    if (overlay) {
      overlay.classList.add('unlocking');
      setTimeout(function(){
        overlay.remove();
        hideReadOnlyBanner();
        resetAutoLock();
        if (pendingUnlockCallback) { pendingUnlockCallback(); pendingUnlockCallback = null; }
        showToast('Unlock berjaya — mod edit aktif');
      }, 300);
    }
  } else {
    /* Wrong */
    var attempts = recordFailedAttempt();
    lockEntry = '';
    updateLockDots();
    var errEl = document.getElementById('lock-error');
    if (errEl) {
      var remaining_attempts = MAX_ATTEMPTS - getAttempts();
      errEl.textContent = isLockedOut()
        ? 'Akaun dikunci selama 5 minit.'
        : 'PIN salah. ' + remaining_attempts + ' percubaan lagi.';
      errEl.classList.add('shake');
      setTimeout(function(){ errEl.classList.remove('shake'); }, 500);
    }
    if (isLockedOut()) {
      disableLockKeypad(true);
      showLockScreen();
    }
  }
}

/* ── Change PIN ── */
function openChangePinModal() {
  if(!isUnlocked){ promptUnlock(openChangePinModal); return; }
  if (document.getElementById('change-pin-overlay')) return;
  var overlay = document.createElement('div');
  overlay.id = 'change-pin-overlay';
  overlay.className = 'backup-modal-overlay';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };

  overlay.innerHTML =
    '<div class="backup-modal">' +
      '<div class="backup-modal-hdr">' +
        '<span>&#128274; Tukar PIN</span>' +
        '<button onclick="document.getElementById(\'change-pin-overlay\').remove()">&#10005;</button>' +
      '</div>' +
      '<div class="backup-section">' +
        '<div class="add-item-row">' +
          '<label class="add-item-lbl">PIN Semasa</label>' +
          '<input id="pin-current" type="password" inputmode="numeric" maxlength="4" ' +
            'class="add-item-inp" placeholder="Masukkan PIN semasa" ' +
            'autocomplete="off" pattern="[0-9]*"/>' +
        '</div>' +
        '<div class="add-item-row">' +
          '<label class="add-item-lbl">PIN Baru</label>' +
          '<input id="pin-new" type="password" inputmode="numeric" maxlength="4" ' +
            'class="add-item-inp" placeholder="4 digit PIN baru" ' +
            'autocomplete="off" pattern="[0-9]*"/>' +
        '</div>' +
        '<div class="add-item-row">' +
          '<label class="add-item-lbl">Sahkan PIN</label>' +
          '<input id="pin-confirm" type="password" inputmode="numeric" maxlength="4" ' +
            'class="add-item-inp" placeholder="Ulang PIN baru" ' +
            'autocomplete="off" pattern="[0-9]*"/>' +
        '</div>' +
        '<button class="backup-action-btn primary" style="width:100%;margin-top:4px" ' +
          'onclick="saveNewPin()">Simpan PIN Baru</button>' +
        '<div style="margin-top:10px;font-size:12px;color:#9ca3af;text-align:center">' +
          'PIN lalai: 1234. Tukar selepas pertama kali log masuk.' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  setTimeout(function(){ var el=document.getElementById('pin-current'); if(el) el.focus(); }, 200);
}

function saveNewPin() {
  var cur  = (document.getElementById('pin-current') ||{}).value||'';
  var nw   = (document.getElementById('pin-new')     ||{}).value||'';
  var conf = (document.getElementById('pin-confirm') ||{}).value||'';

  if (!checkPin(cur)) { showToast('PIN semasa salah!'); return; }
  if (nw.length !== 4 || !/^\d{4}$/.test(nw)) { showToast('PIN baru mesti 4 digit nombor!'); return; }
  if (nw !== conf) { showToast('PIN tidak sepadan!'); return; }
  if (nw === DEFAULT_PIN) { showToast('Jangan guna PIN lalai 1234!'); return; }

  localStorage.setItem(STORAGE_KEY + '_pin_hash', hashPin(nw));
  showToast('PIN berjaya ditukar \u2713');
  var ov = document.getElementById('change-pin-overlay');
  if (ov) ov.remove();
}

/* ── Auto-lock edits after inactivity ── */
var lockTimer = null;
var AUTO_LOCK_DELAY = 10 * 60 * 1000; /* Re-lock edits after 10 min idle */

document.addEventListener('visibilitychange', function(){
  if (document.hidden) {
    lockTimer = setTimeout(function(){
      if (isUnlocked) {
        isUnlocked = false;
        showReadOnlyBanner();
        showToast('Sesi tamat — app kembali ke mod baca sahaja');
      }
    }, AUTO_LOCK_DELAY);
  } else {
    clearTimeout(lockTimer);
  }
});

function resetAutoLock(){
  clearTimeout(lockTimer);
  lockTimer = setTimeout(function(){
    if(isUnlocked){
      isUnlocked=false;
      showReadOnlyBanner();
      showToast('Sesi tamat — app kembali ke mod baca sahaja');
    }
  }, AUTO_LOCK_DELAY);
}


loadImportedInventory();
loadData();
/* App opens in read-only mode — PIN required for edits */
isUnlocked = false;
showReadOnlyBanner();
setTimeout(checkCloudOnLoad, 1500);
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./sw.js').catch(function(e){console.log('SW:',e);});
  });
}

/* ═══════════════════════════════════════════════════════
   FEATURE 1: BACKUP REMINDER ON APP CLOSE
   Shows a toast + export button when user navigates away
   ═══════════════════════════════════════════════════════ */

function getTotalScans(){
  return Object.values(qtyCounts).reduce(function(a,b){return a+b;},0);
}

/* Track whether user has exported this session */
var exportedThisSession = false;
var sessionStartCounts  = JSON.stringify(qtyCounts);  /* snapshot on load */

function hasNewDataSinceExport(){
  return !exportedThisSession && JSON.stringify(qtyCounts) !== sessionStartCounts;
}

/* Intercept page hide / visibility change (fires when phone locks, switches app, closes) */
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'hidden' && hasNewDataSinceExport()){
    /* Auto-save to cloud backup whenever app goes to background */
    cloudAutoBackup();
  }
});

window.addEventListener('pagehide', function(){
  if(hasNewDataSinceExport()) cloudAutoBackup();
});

/* Show backup bar after each save if data exists */
function showBackupBar(){
  var existing = document.getElementById('backup-bar');
  if(existing) return;  /* already showing */
  if(!getTotalScans()) return;  /* nothing to back up */

  var bar = document.createElement('div');
  bar.id = 'backup-bar';
  bar.className = 'backup-bar';
  bar.innerHTML =
    '<div class="backup-bar-msg">&#128274; Data belum diexport</div>'+
    '<div class="backup-bar-btns">'+
      '<button class="backup-bar-btn cloud" onclick="cloudBackup()">&#9729; Cloud</button>'+
      '<button class="backup-bar-btn excel" onclick="backupExportXLSX()">&#8659; Excel</button>'+
      '<button class="backup-bar-dismiss" onclick="dismissBackupBar()">&#10005;</button>'+
    '</div>';
  document.querySelector('.app').appendChild(bar);
}

function dismissBackupBar(){
  var bar = document.getElementById('backup-bar');
  if(bar) bar.remove();
}

function backupExportXLSX(){
  exportXLSX();
  exportedThisSession = true;
  sessionStartCounts  = JSON.stringify(qtyCounts);
  dismissBackupBar();
}

/* ═══════════════════════════════════════════════════════
   FEATURE 2: CLOUD SYNC
   Saves full snapshot to window.storage (persistent API)
   Any phone/browser can restore from it anytime
   ═══════════════════════════════════════════════════════ */

var CLOUD_KEY = 'stocktake_' + (window.STORAGE_KEY||'default');

function cloudBackup(){
  var payload = {
    ts:          Date.now(),
    branch:      window.BRANCH_SLUG || 'default',
    qtyCounts:   qtyCounts,
    historyLog:  historyLog.slice(0, 2000),
    recentScans: recentScans,
    customColors: (function(){
      var cc={};
      if(typeof BUILTIN_COLOR_CODES !== 'undefined'){
        Object.keys(COLOR_CODES).forEach(function(k){
          if(!BUILTIN_COLOR_CODES[k]) cc[k]=COLOR_CODES[k];
        });
      }
      return cc;
    })(),
    version: 2
  };

  if(window.storage){
    window.storage.set(CLOUD_KEY, JSON.stringify(payload), false)
      .then(function(r){
        if(r){
          exportedThisSession = true;
          sessionStartCounts  = JSON.stringify(qtyCounts);
          dismissBackupBar();
          showToast('\u2601 Cloud backup berjaya! ' + fmtTime(Date.now()));
          updateCloudStatus('backed-up');
        } else {
          showToast('Cloud backup gagal — export Excel sebagai backup');
        }
      }).catch(function(){ showToast('Cloud tidak tersedia — export Excel'); });
  } else {
    showToast('Cloud tidak tersedia — export Excel sebagai backup');
    backupExportXLSX();
  }
}

function cloudAutoBackup(){
  /* Silent auto-backup, no toast */
  if(!window.storage) return;
  var payload = {
    ts:          Date.now(),
    branch:      window.BRANCH_SLUG||'default',
    qtyCounts:   qtyCounts,
    historyLog:  historyLog.slice(0,2000),
    recentScans: recentScans,
    version: 2
  };
  window.storage.set(CLOUD_KEY, JSON.stringify(payload), false).catch(function(){});
}

function cloudRestore(){
  if(!window.storage){
    showToast('Cloud tidak tersedia');
    return;
  }
  showToast('Memuat semula dari cloud...');
  window.storage.get(CLOUD_KEY, false)
    .then(function(result){
      if(!result || !result.value){
        showToast('Tiada backup cloud dijumpai untuk cawangan ini');
        return;
      }
      var data = JSON.parse(result.value);
      if(!data || !data.qtyCounts){
        showToast('Data backup tidak sah');
        return;
      }
      /* Confirm before overwriting */
      showRestoreConfirm(data);
    })
    .catch(function(){
      showToast('Gagal memuat cloud backup');
    });
}

function showRestoreConfirm(data){
  var existing = document.getElementById('restore-overlay');
  if(existing) existing.remove();

  var totalPcs = Object.values(data.qtyCounts).reduce(function(a,b){return a+b;},0);
  var skus     = Object.keys(data.qtyCounts).length;
  var backupDate = fmtTime(data.ts);

  var overlay = document.createElement('div');
  overlay.id  = 'restore-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;';

  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:100%;max-width:360px;';
  box.innerHTML =
    '<div style="font-size:18px;font-weight:700;margin-bottom:6px">&#9729; Pulihkan dari Cloud?</div>'+
    '<div style="font-size:13px;color:#6b7280;margin-bottom:16px">Backup dijumpai:</div>'+
    '<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;line-height:1.8">'+
      '<div><b>Tarikh:</b> '+backupDate+'</div>'+
      '<div><b>Cawangan:</b> '+escHtml(data.branch)+'</div>'+
      '<div><b>Jumlah pieces:</b> '+totalPcs+'</div>'+
      '<div><b>Colour lines:</b> '+skus+'</div>'+
      '<div><b>History records:</b> '+(data.historyLog?data.historyLog.length:0)+'</div>'+
    '</div>'+
    '<div style="color:#dc2626;font-size:12px;margin-bottom:16px">&#9888; Data semasa akan <b>digantikan</b> dengan data backup ini.</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button id="restore-cancel-btn" style="flex:1;height:44px;border-radius:10px;border:2px solid #e5e5e5;background:#fff;font-size:14px;font-weight:600;cursor:pointer">Batal</button>'+
      '<button id="restore-confirm-btn" style="flex:1;height:44px;border-radius:10px;border:none;background:#1a1a1a;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Ya, Pulihkan</button>'+
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('restore-cancel-btn').onclick  = function(){ overlay.remove(); };
  document.getElementById('restore-confirm-btn').onclick = function(){
    /* Restore data */
    qtyCounts   = data.qtyCounts;
    historyLog  = data.historyLog  || [];
    recentScans = data.recentScans || [];
    /* Restore custom colours if any */
    if(data.customColors){
      Object.keys(data.customColors).forEach(function(k){
        COLOR_CODES[k] = data.customColors[k];
      });
      try{ localStorage.setItem(STORAGE_KEY+'_custom_colors', JSON.stringify(data.customColors)); }catch(e){}
    }
    saveData();
    updateStats();
    renderRecent();
    overlay.remove();
    sessionStartCounts = JSON.stringify(qtyCounts);
    exportedThisSession = true;
    showToast('\u2705 Data berjaya dipulihkan!');
  };
}

function updateCloudStatus(status){
  var el = document.getElementById('cloud-status');
  if(!el) return;
  if(status === 'backed-up'){
    el.textContent = '\u2601 Synced';
    el.style.color = '#16a34a';
  } else if(status === 'pending'){
    el.textContent = '\u2601 Belum sync';
    el.style.color = '#f59e0b';
  }
}

/* Hook into saveData to show backup bar after changes */
var _origSaveData = saveData;
saveData = function(){
  _origSaveData();
  updateCloudStatus('pending');
  /* Show backup bar after a short delay so it doesn't interrupt the scan flow */
  setTimeout(showBackupBar, 3000);
};

/* Check for existing cloud backup on load */
function checkCloudOnLoad(){
  if(!window.storage) return;
  window.storage.get(CLOUD_KEY, false)
    .then(function(result){
      if(result && result.value){
        var data = JSON.parse(result.value);
        var cloudTotal = data.qtyCounts ? Object.values(data.qtyCounts).reduce(function(a,b){return a+b;},0) : 0;
        var localTotal = getTotalScans();
        /* If cloud has more data than local, offer to restore */
        if(cloudTotal > localTotal && localTotal === 0){
          showToast('\u2601 Backup cloud dijumpai! Pergi Settings untuk pulihkan.');
          updateCloudStatus('pending');
        } else if(cloudTotal > 0){
          updateCloudStatus('backed-up');
        }
      }
    }).catch(function(){});
}


/* ═══════════════════════════════════════════════════════════════════════════
   SALES / TRANSFER TAB
   ═══════════════════════════════════════════════════════════════════════════ */

var salesType = 'sale';          /* 'sale' | 'transfer' */
var salesActiveBc = '';
var salesActiveColor = null;     /* null = not chosen yet, '' = no colour */
var salesLog = [];               /* [{ ts, bc, desc, size, colorCode, colorName, type, dest, notes, qty, balanceBefore, balanceAfter }] */

/* Load sales log from localStorage */
function loadSalesLog(){
  try {
    var raw = localStorage.getItem(window.STORAGE_KEY + '_sales');
    salesLog = raw ? JSON.parse(raw) : [];
  } catch(e){ salesLog = []; }
}

/* Save sales log to localStorage */
function saveSalesLog(){
  try {
    localStorage.setItem(window.STORAGE_KEY + '_sales', JSON.stringify(salesLog));
  } catch(e){}
}

/* Switch between Sale and Transfer */
function setSalesType(t){
  salesType = t;
  document.getElementById('type-btn-sale').classList.toggle('active', t === 'sale');
  document.getElementById('type-btn-transfer').classList.toggle('active', t === 'transfer');
  var destRow = document.getElementById('sales-dest-row');
  if (destRow) destRow.style.display = t === 'transfer' ? 'flex' : 'none';
  var saveBtn = document.getElementById('sales-save-btn');
  if (saveBtn) saveBtn.textContent = t === 'sale' ? 'Simpan Jualan' : 'Simpan Pindahan';
  updateModeBanner('sales', t);
}

/* Barcode input handler */
function onSalesBcInput(val){ /* live feedback could go here */ }

function onSalesBcEnter(){
  /* No PIN needed to look up an item — only saving requires unlock */
  var inp = document.getElementById('sales-bc-input');
  var bc = inp ? inp.value.trim() : '';
  if(!bc){ showToast('Sila imbas atau taip barkod'); return; }
  lookupSalesItem(bc);
}

function lookupSalesItem(bc){
  /* Find item in inventory */
  var item = inv[bc];
  if(!item){
    showToast('Barkod tidak dijumpai — ' + bc);
    return;
  }
  salesActiveBc = bc;
  salesActiveColor = null;

  /* Populate card */
  document.getElementById('sales-item-name').textContent = item.description || bc;
  document.getElementById('sales-item-meta').textContent =
    (item.size ? 'Saiz: ' + item.size + '  ' : '') +
    (item.price ? 'RM ' + parseFloat(item.price).toFixed(2) : '');

  /* Reset colour */
  updateSalesColorDisplay();

  /* Hide balance until colour chosen */
  document.getElementById('sales-balance-row').style.display = 'none';

  /* Show/hide transfer dest */
  document.getElementById('sales-dest-row').style.display = salesType === 'transfer' ? 'flex' : 'none';

  /* Reset qty */
  document.getElementById('sales-qty').value = 1;

  /* Show card */
  document.getElementById('sales-item-card').style.display = 'block';

  /* Update save btn label */
  document.getElementById('sales-save-btn').textContent =
    salesType === 'sale' ? 'Simpan Jualan' : 'Simpan Pindahan';
}

/* Colour picker for sales — no PIN needed just to pick colour */
function pickSalesColor(){
  openColorPicker(function(code){
    salesActiveColor = code;
    updateSalesColorDisplay();
    updateSalesBalance();
  }, salesActiveColor === null ? '' : salesActiveColor);
}

function setSalesNoColor(){
  salesActiveColor = '';
  updateSalesColorDisplay();
  updateSalesBalance();
}

function updateSalesColorDisplay(){
  var preview = document.getElementById('sales-color-preview');
  var colorBtn = document.getElementById('sales-color-btn');
  var noColorBtn = document.getElementById('sales-nocolor-btn');
  if(salesActiveColor === null){
    if(preview) preview.style.display = 'none';
    if(colorBtn){ colorBtn.style.background=''; colorBtn.style.color=''; }
    if(noColorBtn){ noColorBtn.style.background=''; noColorBtn.style.color=''; }
    return;
  }
  if(salesActiveColor === ''){
    /* No colour selected */
    if(preview) preview.style.display = 'none';
    if(noColorBtn){ noColorBtn.style.background='#1a1a1a'; noColorBtn.style.color='#fff'; }
    if(colorBtn){ colorBtn.style.background=''; colorBtn.style.color=''; }
  } else {
    var info = getColorInfo(salesActiveColor);
    var hex = info ? info.hex : '#ccc';
    var name = info ? info.name : salesActiveColor;
    if(preview){
      preview.style.display = 'flex';
      preview.innerHTML =
        '<span style="width:18px;height:18px;border-radius:50%;background:' + hex +
        ';border:1.5px solid #ccc;display:inline-block"></span>' +
        '<span>' + salesActiveColor + ' — ' + name + '</span>';
    }
    if(colorBtn){ colorBtn.style.background=''; colorBtn.style.color=''; }
    if(noColorBtn){ noColorBtn.style.background=''; noColorBtn.style.color=''; }
  }
}

function updateSalesBalance(){
  if(salesActiveColor === null || !salesActiveBc) return;
  var key = salesActiveBc + '::' + (salesActiveColor === '' ? 'NONE' : salesActiveColor);
  var stockQty = qtyCounts[key] || 0;
  var deduct = parseInt(document.getElementById('sales-qty').value) || 1;
  var after = stockQty - deduct;

  var balRow = document.getElementById('sales-balance-row');
  balRow.style.display = 'flex';
  document.getElementById('sales-balance-qty').textContent = stockQty;
  var afterEl = document.getElementById('sales-balance-after');
  afterEl.textContent = after;
  afterEl.className = 'balance-after' + (after < 0 ? ' negative' : '');
}

function onSalesQtyInput(){
  updateSalesBalance();
}

function adjSalesQty(d){
  var inp = document.getElementById('sales-qty');
  var v = Math.max(1, (parseInt(inp.value) || 1) + d);
  inp.value = v;
  updateSalesBalance();
}

/* Save a sale/transfer entry */
function saveSalesEntry(){
  if(!isUnlocked){ promptUnlock(saveSalesEntry); return; }
  if(!salesActiveBc){ showToast('Tiada item dipilih'); return; }
  if(salesActiveColor === null){ showToast('Sila pilih warna atau tekan Tiada Warna'); return; }

  var dest = salesType === 'transfer'
    ? (document.getElementById('sales-dest-select').value || '')
    : '';
  if(salesType === 'transfer' && !dest){
    showToast('Sila pilih cawangan tujuan');
    return;
  }

  var qtyEl = document.getElementById('sales-qty');
  var qty = Math.max(1, parseInt(qtyEl.value) || 1);
  var notes = (document.getElementById('sales-notes').value || '').trim();

  var key = salesActiveBc + '::' + (salesActiveColor === '' ? 'NONE' : salesActiveColor);
  var stockBefore = qtyCounts[key] || 0;
  var stockAfter  = stockBefore - qty;

  /* Confirm dialog — always shown before deducting */
  var actionLabel = salesType === 'sale' ? 'JUALAN' : 'PINDAHAN';
  var destLabel   = salesType === 'transfer' && dest ? ' → ' + dest : '';
  var colorLabel  = salesActiveColor === '' ? 'Tiada Warna' : salesActiveColor;
  var item = inv[salesActiveBc] || {};
  var confirmMsg  =
    actionLabel + destLabel + '\n\n' +
    (item.description || salesActiveBc) + '\n' +
    'Warna: ' + colorLabel + '\n' +
    'Qty tolak: ' + qty + ' unit\n' +
    'Stok sebelum: ' + stockBefore + '  →  Baki: ' + (stockBefore - qty) + '\n\n' +
    'Teruskan?';
  if(!confirm(confirmMsg)) return;

  /* Extra warn if deducting more than counted */
  if(stockAfter < 0){
    if(!confirm('⚠️ Baki akan menjadi NEGATIF (' + stockAfter + '). Teruskan?')){
      return;
    }
  }

  /* Deduct from qtyCounts */
  if(stockAfter <= 0){
    delete qtyCounts[key];
  } else {
    qtyCounts[key] = stockAfter;
  }
  saveData();

  /* Log the entry */
  var item = inv[salesActiveBc] || {};
  var colorInfo = salesActiveColor === '' ? null : getColorInfo(salesActiveColor);
  var entry = {
    ts: new Date().toISOString(),
    bc: salesActiveBc,
    desc: item.description || salesActiveBc,
    size: item.size || '',
    colorCode: salesActiveColor,
    colorName: colorInfo ? colorInfo.name : (salesActiveColor === '' ? 'Tiada Warna' : salesActiveColor),
    type: salesType,
    dest: dest,
    notes: notes,
    qty: qty,
    balanceBefore: stockBefore,
    balanceAfter: stockAfter < 0 ? 0 : stockAfter
  };
  salesLog.unshift(entry);
  saveSalesLog();

  /* Also add to history log */
  historyLog.unshift({
    ts: entry.ts,
    bc: salesActiveBc,
    colorCode: salesActiveColor,
    desc: item.description || salesActiveBc,
    size: item.size || '',
    oldQty: stockBefore,
    newQty: stockAfter < 0 ? 0 : stockAfter,
    type: salesType === 'sale' ? 'sale' : 'transfer'
  });
  saveData();

  var label = salesType === 'sale' ? 'Jualan' : ('Pindahan → ' + dest);
  showToast(label + ' disimpan — ' + qty + ' unit ditolak');

  /* Reset form */
  salesActiveBc = '';
  salesActiveColor = null;
  document.getElementById('sales-bc-input').value = '';
  document.getElementById('sales-qty').value = 1;
  document.getElementById('sales-notes').value = '';
  document.getElementById('sales-item-card').style.display = 'none';

  renderSalesLog();
}

/* Render sales log */
function renderSalesLog(){
  var el = document.getElementById('sales-log-list');
  if(!el) return;
  if(!salesLog.length){
    el.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:32px;font-size:13px">Tiada rekod lagi</div>';
    return;
  }
  el.innerHTML = salesLog.map(function(e){
    var dt = new Date(e.ts);
    var ts = dt.toLocaleDateString('ms-MY') + ' ' + dt.toLocaleTimeString('ms-MY', {hour:'2-digit',minute:'2-digit'});
    var typeLabel = e.type === 'sale' ? '💸 Jualan' : '🔀 Pindahan';
    var typeClass = e.type === 'sale' ? 'sale' : 'transfer';
    var colorDot = (e.colorCode && e.colorCode !== '') ?
      (function(){ var ci = getColorInfo(e.colorCode); return ci ?
        '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + ci.hex + ';margin-right:4px;border:1px solid #ccc"></span>' : ''; })() : '';
    var meta = (e.colorCode ? (colorDot + (e.colorName || e.colorCode)) : 'Tiada Warna') +
               (e.size ? ' · ' + e.size : '') +
               (e.dest ? ' · → ' + e.dest : '') +
               (e.notes ? ' · ' + e.notes : '');
    var balText = 'Stok: ' + e.balanceBefore + ' → ' + e.balanceAfter;
    return '<div class="sales-log-item">' +
      '<div class="sales-log-top">' +
        '<span class="sales-log-type ' + typeClass + '">' + typeLabel + '</span>' +
        '<span class="sales-log-qty">−' + e.qty + '</span>' +
      '</div>' +
      '<div class="sales-log-name">' + (e.desc || e.bc) + '</div>' +
      '<div class="sales-log-meta">' + meta + ' · ' + balText + '</div>' +
      '<div class="sales-log-ts">' + ts + ' · ' + e.bc + '</div>' +
    '</div>';
  }).join('');
}

/* Export sales log to Excel */
function exportSalesExcel(){
  var rows = [['Tarikh','Masa','Jenis','Barkod','Penerangan','Saiz','Kod Warna','Nama Warna','Qty Tolak','Stok Sebelum','Stok Selepas','Destinasi','Nota']];
  salesLog.forEach(function(e){
    var dt = new Date(e.ts);
    rows.push([
      dt.toLocaleDateString('ms-MY'),
      dt.toLocaleTimeString('ms-MY',{hour:'2-digit',minute:'2-digit'}),
      e.type === 'sale' ? 'Jualan' : 'Pindahan',
      e.bc, e.desc || '', e.size || '',
      e.colorCode || '', e.colorName || '',
      e.qty, e.balanceBefore, e.balanceAfter,
      e.dest || '', e.notes || ''
    ]);
  });
  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jualan & Pindahan');
  var d = new Date();
  var stamp = d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  XLSX.writeFile(wb, 'Sales_' + window.STORAGE_KEY + '_' + stamp + '.xlsx');
}

/* Initialise sales tab on load */
loadSalesLog();
renderSalesLog();

/* ═══════════════════════════════════════════════════════════════════════════
   HOMEPAGE / MODE SELECTOR
   ═══════════════════════════════════════════════════════════════════════════ */

function showHomepage(){
  var hp = document.getElementById('homepage');
  if(hp){ hp.classList.remove('hidden'); }
  /* Stamp branch name */
  var nameEl = document.getElementById('home-branch-name');
  if(nameEl){
    nameEl.textContent = (window.BRANCH_SLUG || 'KG BARU').replace(/-/g,' ').toUpperCase();
  }
}

function dismissHomepage(){
  var hp = document.getElementById('homepage');
  if(hp){ hp.classList.add('hidden'); }
}

function selectHomeMode(mode){
  dismissHomepage();
  if(mode === 'scan'){
    switchTab('scan');
  } else if(mode === 'sale'){
    switchTab('sales');
    setSalesType('sale');
  } else if(mode === 'transfer'){
    switchTab('sales');
    setSalesType('transfer');
  }
}

/* Show homepage on every app open (after PIN check if needed) */
showHomepage();
