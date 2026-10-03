import {EditorView,basicSetup} from 'codemirror';
import {EditorState} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {indentWithTab} from '@codemirror/commands';
import {syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {cpp} from '@codemirror/lang-cpp';
import {tags} from '@lezer/highlight';
import DOMPurify from 'dompurify';
const theme=EditorView.theme({
  '&':{height:'100%',fontSize:'13px',color:'#3b4657',backgroundColor:'transparent'},
  '.cm-scroller':{fontFamily:'"Cascadia Code", "Consolas", monospace',lineHeight:'1.85',overflow:'auto'},
  '.cm-content':{padding:'17px 0',caretColor:'#607b9f'},
  '.cm-line':{padding:'0 20px 0 10px'},
  '.cm-gutters':{backgroundColor:'transparent',color:'#afb7c3',border:'none',fontSize:'11px'},
  '.cm-lineNumbers .cm-gutterElement':{minWidth:'40px',padding:'0 12px 0 8px'},
  '.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'#edf2f780'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#dce6f3'},
  '&.cm-focused':{outline:'none'},
  '.cm-cursor':{borderLeftColor:'#607b9f'},
  '.cm-tooltip':{border:'1px solid #dee5ef',borderRadius:'8px',backgroundColor:'#f9fafc'},
  '.cm-panels':{backgroundColor:'#f2f5f9',color:'#64748b'},
  '.cm-panel.cm-search input':{border:'1px solid #dce3ed',borderRadius:'5px'}
});
const highlight=HighlightStyle.define([
  {tag:tags.keyword,color:'#8b7796'},
  {tag:[tags.string,tags.character],color:'#6d8d7d'},
  {tag:[tags.number,tags.bool],color:'#b18961'},
  {tag:tags.comment,color:'#9da6b3',fontStyle:'italic'},
  {tag:tags.typeName,color:'#648fa1'},
  {tag:tags.function(tags.variableName),color:'#5d7f9f'},
  {tag:tags.operator,color:'#8293a7'}
]);
window.LeetEditor={
  create(parent,onChange){
    const extensions=[basicSetup,cpp(),keymap.of([indentWithTab]),EditorState.tabSize.of(4),theme,syntaxHighlighting(highlight),EditorView.cspNonce.of('leettrack-editor'),EditorView.updateListener.of(update=>{if(update.docChanged)onChange();})];
    const view=new EditorView({extensions,parent});
    return {get:()=>view.state.doc.toString(),set:doc=>view.setState(EditorState.create({doc,extensions})),replace:doc=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:doc}}),focus:()=>view.focus(),measure:()=>view.requestMeasure()};
  },
  sanitize:html=>DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','strong','em','b','i','u','s','pre','code','ul','ol','li','br','div','span','sub','sup','table','thead','tbody','tr','td','th','blockquote','h3','h4','a'],ALLOWED_ATTR:['href'],ALLOW_DATA_ATTR:false})
};
