"use client";
import {useEffect,useState} from 'react';
import {api} from '@/lib/client/api';
import {S} from './styles';
type Card = {id:number;question:string;answer:string;suspended:boolean};
export default function CardManager({domainId,version,onChange}:{domainId:number;version:number;onChange:()=>void}) {
  const [cards,setCards]=useState<Card[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState(false), [due,setDue]=useState(false);
  const [edit,setEdit]=useState<Card|null>(null);
  async function load(){try{const data=await api<{cards:Card[]}>('GET',`/api/cards?domainId=${domainId}&filter=${due?'due':'all'}`);setCards(data.cards);}catch(e){setError(String(e));}}
  useEffect(()=>{void load();},[domainId,version,due]);
  async function change(method:string,body:unknown){setBusy(true);setError('');try{await api(method,'/api/cards',body);setEdit(null);await load();onChange();}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <details style={{...S.card,marginTop:20}}><summary>Le mie carte ({cards.length})</summary>
    <label><input type="checkbox" checked={due} onChange={e=>setDue(e.target.checked)}/> Solo in scadenza</label>
    {error && <p role="alert" style={{color:'var(--color-danger)'}}>{error}</p>}
    {cards.map(card=><div key={card.id} style={{borderTop:'1px solid var(--border)',padding:'12px 0'}}>
      {edit?.id===card.id ? <>
        <label>Domanda<textarea aria-label="Domanda della carta" style={S.textarea} value={edit.question} onChange={e=>setEdit({...edit,question:e.target.value})}/></label>
        <label>Risposta<textarea aria-label="Risposta della carta" style={S.textarea} value={edit.answer} onChange={e=>setEdit({...edit,answer:e.target.value})}/></label>
        <button style={S.send} disabled={busy} onClick={()=>change('PATCH',{id:edit.id,question:edit.question,answer:edit.answer})}>Salva</button>
        <button style={S.ghost} onClick={()=>setEdit(null)}>Annulla</button>
      </> : <><b>{card.question}</b><p style={{whiteSpace:'pre-wrap'}}>{card.answer}</p>
        {card.suspended && <span>Sospesa · </span>}
        <button style={S.ghost} disabled={busy} onClick={()=>setEdit({...card})}>Modifica</button>
        <button style={S.ghost} disabled={busy} onClick={()=>change('PATCH',{id:card.id,suspended:!card.suspended})}>{card.suspended?'Riattiva':'Sospendi'}</button>
        <button style={{...S.ghost,color:'var(--color-danger)'}} disabled={busy} onClick={()=>change('DELETE',{id:card.id})}>Elimina</button>
      </>}
    </div>)}
    {!cards.length && <p>Nessuna carta.</p>}
  </details>;
}
