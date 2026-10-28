"use client";
import {useEffect,useState} from 'react';
import {Moon,Sun} from 'lucide-react';
import {useERP} from '../core/erp-context';
import {Button} from './ui';
export default function ThemeToggle(){
 const {tr}=useERP();const [theme,setTheme]=useState('dark');
 useEffect(()=>{
   const sync=()=>setTheme(document.documentElement.dataset.theme==='light'?'light':'dark');sync();
   const stored=(event:StorageEvent)=>{if(event.key==='odin-theme'){document.documentElement.dataset.theme=event.newValue==='light'?'light':'dark';sync();}};
   window.addEventListener('odin:theme-change',sync);window.addEventListener('storage',stored);
   return()=>{window.removeEventListener('odin:theme-change',sync);window.removeEventListener('storage',stored);};
 },[]);
 const label=theme==='dark'?'Switch to light mode':'Switch to dark mode';
 return <Button className="theme-toggle" data-testid="theme-toggle" title={tr(label)} aria-label={tr(label)} onClick={()=>{
   const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;setTheme(next);
   document.querySelector('meta[name="theme-color"]')?.setAttribute('content',next==='light'?'#edf3fb':'#030c1d');
   try{localStorage.setItem('odin-theme',next);}catch{/* The control still works when browser storage is disabled. */}
   window.dispatchEvent(new Event('odin:theme-change'));
 }}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{tr(label)}</span></Button>;
}
