import {toPaise} from './finance.js';
import {recordAudit} from './financial-audit.js';

export const EXPENSE_CATEGORIES=['supplies','housekeeping','maintenance','utilities','transport','staff','other'];
const METHODS=['cash','upi','card','bank'];
export function ensureExpenseSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses(
      id INTEGER PRIMARY KEY,
      business_date TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN('supplies','housekeeping','maintenance','utilities','transport','staff','other')),
      amount_paise INTEGER NOT NULL CHECK(amount_paise>0),
      method TEXT NOT NULL CHECK(method IN('cash','upi','card','bank')),
      payee TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL UNIQUE,
      actor_id INTEGER,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_date,id);
  `);
}
export function expenseDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||
    !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
    new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Use a valid YYYY-MM-DD expense date');
  return value;
}
export function recordExpense(db,input,actor){
  if(!actor||!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid expense details');
  const business_date=expenseDate(input.business_date);
  const category=input.category,method=input.method;
  if(!EXPENSE_CATEGORIES.includes(category))throw new Error('Choose an expense category');
  if(!METHODS.includes(method))throw new Error('Choose cash, UPI, card or bank');
  const amount_paise=toPaise(input.amount);
  if(amount_paise<=0)throw new Error('Expense must exceed zero');
  const payee=typeof input.payee==='string'?input.payee.trim():'',
    note=typeof input.note==='string'?input.note.trim():'';
  if(payee.length>120||note.length>300)throw new Error('Expense payee or note too long');
  const request_id=input.request_id;
  if(typeof request_id!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(request_id))
    throw new Error('Unique expense request ID required');
  return db.transaction(()=>{
    const existing=db.prepare('SELECT * FROM expenses WHERE request_id=?').get(request_id);
    if(existing){
      if(existing.business_date!==business_date||existing.category!==category||
        existing.amount_paise!==amount_paise||existing.method!==method||
        existing.payee!==payee||existing.note!==note)
        throw new Error('Expense request ID already used with different details');
      return {...existing,already_recorded:true};
    }
    const inserted=db.prepare(`INSERT INTO expenses
      (business_date,category,amount_paise,method,payee,note,request_id,actor_id,actor_username)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(business_date,category,amount_paise,method,payee,note,
      request_id,actor.id,actor.username);
    const id=Number(inserted.lastInsertRowid);
    recordAudit(db,actor,'expense.recorded','expense',id,{business_date,category,amount_paise,method});
    return {...db.prepare('SELECT * FROM expenses WHERE id=?').get(id),already_recorded:false};
  })();
}
export function listExpenses(db,date){
  date=expenseDate(date);
  return db.prepare(`SELECT id,business_date,category,amount_paise,method,payee,note,
    actor_username,created_at FROM expenses WHERE business_date=? ORDER BY id DESC`).all(date);
}
