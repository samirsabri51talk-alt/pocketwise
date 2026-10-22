import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v);
export const entrySchema = z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(100),kind:z.enum(['income','expense','saving']),category:z.string().max(60),amount:z.number().positive().max(1e9).refine(n=>Math.abs(n*100-Math.round(n*100))<0.0001),date,status:z.enum(['planned','done']),essential:z.boolean(),note:z.string().max(400),direction:z.enum(['deposit','withdrawal']).optional(),budgetMonth:z.string().regex(/^\d{4}-\d{2}$/).optional()});
export const adjustmentSchema=z.object({id:z.string().min(1).max(80),account:z.enum(['cash','savings']),date,amount:z.number().min(-1e9).max(1e9).refine(n=>Math.abs(n*100-Math.round(n*100))<0.0001),note:z.string().trim().min(1).max(400)});
export const budgetSchema = z.object({entries:z.array(entrySchema).max(5000),opening:z.number().min(-1e9).max(1e9),openingSavings:z.number().min(0).max(1e9).default(0),adjustments:z.array(adjustmentSchema).max(1000).default([]),openingDate:date,target:z.number().positive().max(1e9),caps:z.record(z.number().min(0).max(1e9))}).superRefine((b,ctx)=>{
 if(new Set(b.entries.map(e=>e.id)).size!==b.entries.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate transaction identifiers'});
 if(new Set(b.adjustments.map(e=>e.id)).size!==b.adjustments.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate adjustment identifiers'});
 if(b.entries.some(e=>e.status==='done'&&e.date>today()))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Completed transactions cannot be future dated'});
 if(b.adjustments.some(e=>e.date>today()||e.date<b.openingDate))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Balance adjustments must be dated between the opening date and today'});
 if(b.openingDate>today())ctx.addIssue({code:z.ZodIssueCode.custom,message:'Opening balance date cannot be in the future'});
});
export type Entry=z.infer<typeof entrySchema>;
export type Adjustment=z.infer<typeof adjustmentSchema>;
export type Budget=z.infer<typeof budgetSchema>;
export const categories=['Housing','Household','Utilities','Transport','Installments','Family','Dining & coffee','Shopping','Subscriptions','Other'];
export const money=(n:number)=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(n);
export const monthOf=(d:string)=>d.slice(0,7);
// A budget month is chosen by the user. Every item entered from that plan stays
// in that month, regardless of the transaction date used for reference.
export const planningMonth=(e:Entry)=>e.budgetMonth||monthOf(e.date);
export const budgetDate=(e:Entry,month:string)=>planningMonth(e)===month&&monthOf(e.date)!==month?month+'-01':e.date;
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const lastDay=(m:string)=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).toISOString().slice(0,10);
export function totals(entries:Entry[]) {
  const sum=(kind:string,done=false)=>Math.round(entries.filter(e=>e.kind===kind&&(!done||e.status==='done')).reduce((s,e)=>s+(kind==='saving'&&e.direction==='withdrawal'?-e.amount:e.amount),0)*100)/100;
  return {income:sum('income'),expenses:sum('expense'),savings:sum('saving'),received:sum('income',true),paid:sum('expense',true),saved:sum('saving',true)};
}
export const round=(n:number)=>Math.round(n*100)/100;
export function cashBalance(b:Budget,through=today()) {
 const t=totals(b.entries.filter(e=>e.status==='done'&&e.date>=b.openingDate&&e.date<=through));
 const corrections=b.adjustments.filter(e=>e.account==='cash'&&e.date<=through).reduce((s,e)=>s+e.amount,0);
 return round(b.opening+t.received-t.paid-t.saved+corrections);
}
export function savingsBalance(b:Budget,through=today()) {
 const t=totals(b.entries.filter(e=>e.kind==='saving'&&e.status==='done'&&e.date>=b.openingDate&&e.date<=through));
 const corrections=b.adjustments.filter(e=>e.account==='savings'&&e.date<=through).reduce((s,e)=>s+e.amount,0);
 return round(b.openingSavings+t.saved+corrections);
}
export function forecast(b:Budget,month:string,commissionDelay=0,flexibleCut=0) {
 const start=month+'-01';
 const prior=totals(b.entries.filter(e=>e.status==='done'&&e.date>=b.openingDate&&e.date<start));
 const priorAdjustments=b.adjustments.filter(e=>e.account==='cash'&&e.date<start).reduce((s,e)=>s+e.amount,0);
 const opening=b.openingDate<=lastDay(month)?round(b.opening+prior.received-prior.paid-prior.saved+priorAdjustments):0;
 const adjusted=b.entries.filter(e=>planningMonth(e)===month&&(e.status==='planned'||e.date>=b.openingDate)).map(e=>{
  let d=budgetDate(e,month);
  if(e.kind==='income'&&e.category==='Commission'&&e.status==='planned') {const v=new Date(d+'T12:00:00Z');v.setUTCDate(v.getUTCDate()+commissionDelay);d=v.toISOString().slice(0,10);}
  const amount=e.kind==='expense'&&!e.essential&&e.status==='planned'?Math.round(e.amount*(1-flexibleCut/100)*100)/100:e.amount;
  return {...e,date:d,amount};
 });
 let cash=opening,min=opening,firstShortfall='';
 const series=Array.from({length:+lastDay(month).slice(-2)},(_,i)=>{
  const d=month+'-'+String(i+1).padStart(2,'0');
  const rows=adjusted.filter(e=>e.date===d),t=totals(rows);
  cash=round(cash+t.income-t.expenses-t.savings+b.adjustments.filter(e=>e.account==='cash'&&e.date===d).reduce((s,e)=>s+e.amount,0));
  min=Math.min(min,cash);if(cash<0&&!firstShortfall)firstShortfall=d;
  return {date:d,cash};
 });
 return {opening,closing:cash,min,firstShortfall,series};
}
export function suggestions(b:Budget,month:string) {
 const e=b.entries.filter(x=>planningMonth(x)===month),t=totals(e),out:{title:string;detail:string;tone:string}[]=[];
 const flexible=e.filter(x=>x.kind==='expense'&&!x.essential), flex=flexible.reduce((s,x)=>s+x.amount,0);
 const remaining=t.income-t.expenses-t.savings;
 if(remaining<0) out.push({title:'Your plan needs a rebalance',detail:`Planned outflows exceed known income by EGP ${money(-remaining)}. Add missing income first, then reduce flexible spending. Avoid committing savings you cannot fund.`,tone:'warning'});
 if(flex) { const grouped:Record<string,number>={};flexible.forEach(x=>grouped[x.category]=(grouped[x.category]||0)+x.amount); const top=Object.entries(grouped).sort((a,b)=>b[1]-a[1])[0];out.push({title:`Start with ${top[0].toLowerCase()}`,detail:`You allocated EGP ${money(top[1])} to flexible ${top[0].toLowerCase()}. A 20% cut frees EGP ${money(top[1]*.2)}. Try that for one month and review.`,tone:'green'}); }
 else out.push({title:'Make the small spends visible',detail:'Log coffee, delivery, shopping and subscriptions as flexible expenses. Recommendations become specific once these amounts are recorded.',tone:'green'});
 const base=forecast(b,month),lateCommission=forecast(b,month,14);
 if(base.min<0) out.unshift({title:'Timing matters as much as totals',detail:`Your dated plan reaches a cash shortfall of EGP ${money(-base.min)}, starting ${base.firstShortfall}. Review due dates and arrange a buffer before committing optional spending. This uses recorded opening cash and prior completed entries, not earlier unpaid income.`,tone:'warning'});
 else if(lateCommission.min<0) out.unshift({title:'Build a buffer for a late commission',detail:`If the planned commission arrives 14 days late, the model needs a buffer of EGP ${money(-lateCommission.min)}. Keep this available before funding optional spending or extra savings. This is a stress test, not a prediction.`,tone:'warning'});
 if(t.income>0) out.push({title:remaining>0?'Check what the surplus still needs to cover':'Protect your essential bills',detail:remaining>0?`EGP ${money(remaining)} is unallocated in your monthly plan. First add transport, personal purchases, annual costs and any missing family expenses. Only money left after those commitments is a candidate for extra savings.`:`Known income is EGP ${money(t.income)}. Keep housing, utilities and minimum installments covered before adding optional commitments.`,tone:'neutral'});
 const essentials=e.filter(x=>x.kind==='expense'&&x.essential).reduce((s,x)=>s+x.amount,0);
 const saved=savingsBalance(b);
 if(essentials>0)out.push({title:'Put your savings goal in context',detail:`This month's known essential costs are EGP ${money(essentials)}. Your recorded savings balance of EGP ${money(saved)} covers ${(saved/essentials).toFixed(1)} months at that level. Your target of EGP ${money(b.target)} represents ${(b.target/essentials).toFixed(1)} months. This depends on an accurate opening savings balance and complete transfers.`,tone:'neutral'});
 const subscriptions=e.filter(x=>x.kind==='expense'&&x.category==='Subscriptions').reduce((s,x)=>s+x.amount,0);
 if(subscriptions>0)out.push({title:'Review what renews quietly',detail:`Subscriptions total EGP ${money(subscriptions)} this month. If that repeats monthly, the annual equivalent is EGP ${money(subscriptions*12)}. Check usage and renewal dates before cancelling or downgrading.`,tone:'green'});
 const late=e.filter(x=>x.status==='planned'&&x.date<today());if(late.length) out.push({title:`${late.length} past-due item${late.length>1?'s':''} to check`,detail:'Confirm what was actually received or paid. Planned income never counts as cash available today.',tone:'warning'});
 Object.entries(b.caps).forEach(([c,cap])=>{const used=e.filter(x=>x.kind==='expense'&&x.category===c).reduce((s,x)=>s+x.amount,0);if(cap>0&&used>cap)out.push({title:`${c} is above its limit`,detail:`Planned plus paid spending is EGP ${money(used)} against EGP ${money(cap)}. Reduce it by EGP ${money(used-cap)} or deliberately revise your limit.`,tone:'warning'});});
 return out;
}
