/** Single-process, file-backed transactional store. Never share this file across replicas. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(nodeScrypt);
const emailRe = /^[^\s@]{1,100}@[^\s@]{1,200}\.[^\s@]{2,40}$/;
export function cleanEmail(v) { const email=String(v||'').trim().toLowerCase();if(!emailRe.test(email)||email.length>240)throw new Error('유효한 이메일 주소가 필요합니다.');return email; }
export function cleanPassword(v) { if(typeof v!=='string'||v.length<12||v.length>128) throw new Error('비밀번호는 12~128자여야 합니다.');return v; }
export async function hashPassword(password){cleanPassword(password);const salt=randomBytes(16).toString('hex');const key=await scrypt(password,Buffer.from(salt,'hex'),64);return `${salt}:${key.toString('hex')}`;}
export async function verifyPassword(password,hash){if(typeof password!=='string'||!hash||typeof hash!=='string')return false;const [salt,hex]=hash.split(':');if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(hex||''))return false;const got=await scrypt(password,Buffer.from(salt,'hex'),64);return timingSafeEqual(got,Buffer.from(hex,'hex'));}
export const tokenHash=(token)=>createHash('sha256').update(token).digest('hex');
export const newId=(prefix)=>`${prefix}_${randomBytes(12).toString('hex')}`;
function empty(){return {version:1,users:[],orders:[],payments:[],sessions:[],audit:[]};}
export class Store {
 constructor(filename){this.filename=filename;this.chain=Promise.resolve();}
 async read(){try{const content=JSON.parse(await readFile(this.filename,'utf8'));if(content.version!==1||!Array.isArray(content.users))throw new Error('Invalid database format');return content;}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
 async transaction(fn){const exec=async()=>{const value=await this.read();const result=await fn(value);await mkdir(dirname(this.filename),{recursive:true,mode:0o700});const tmp=`${this.filename}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,this.filename);return result;};const run=this.chain.then(exec);this.chain=run.catch(()=>{});return run;}
 async findUser(email){const db=await this.read();return db.users.find(u=>u.email===cleanEmail(email))||null;}
 async bootstrapAdmin(email,password){const address=cleanEmail(email);const hashed=await hashPassword(password);return this.transaction(db=>{if(db.users.some(u=>u.role==='admin'))return false;if(db.users.some(u=>u.email===address))throw new Error('Email already exists');db.users.push({id:newId('usr'),email:address,passwordHash:hashed,role:'admin',createdAt:new Date().toISOString(),active:true});return true;});}
 async createUser(email,password,role='customer'){if(!['customer','admin'].includes(role))throw new Error('Invalid role');const address=cleanEmail(email),hashed=await hashPassword(password);return this.transaction(db=>{if(db.users.some(u=>u.email===address))throw new Error('이미 등록된 이메일입니다.');const user={id:newId('usr'),email:address,passwordHash:hashed,role,createdAt:new Date().toISOString(),active:true};db.users.push(user);return {id:user.id,email:user.email,role:user.role};});}
 async login(email,password,{durationMs=7*86400000}={}){const address=cleanEmail(email);const user=(await this.read()).users.find(u=>u.email===address&&u.active);const ok=await verifyPassword(password,user?.passwordHash);if(!ok)return null;const token=randomBytes(32).toString('base64url'),now=Date.now();const csrf=randomBytes(32).toString('base64url');await this.transaction(db=>{db.sessions=db.sessions.filter(s=>s.expires>now);db.sessions.push({hash:tokenHash(token),userId:user.id,csrf,expires:now+durationMs});});return {token,csrf,expires:now+durationMs,user:{id:user.id,email:user.email,role:user.role}};}
 async session(token){if(!token||token.length>100)return null;const db=await this.read(),now=Date.now();const session=db.sessions.find(s=>s.hash===tokenHash(token)&&s.expires>now);const user=db.users.find(u=>u.id===session?.userId&&u.active);if(!session||!user)return null;return {session,user:{id:user.id,email:user.email,role:user.role}};}
 async logout(token){return this.transaction(db=>{db.sessions=db.sessions.filter(s=>s.hash!==tokenHash(token));});}
 async changePassword(userId,oldPassword,newPassword){cleanPassword(newPassword);const db=await this.read(),user=db.users.find(u=>u.id===userId);if(!user||!await verifyPassword(oldPassword,user.passwordHash))throw new Error('현재 비밀번호가 올바르지 않습니다.');const hashed=await hashPassword(newPassword);await this.transaction(d=>{const u=d.users.find(u=>u.id===userId);u.passwordHash=hashed;d.sessions=d.sessions.filter(s=>s.userId!==userId);});}
 async audit(userId,event,details){await this.transaction(db=>{db.audit.push({at:new Date().toISOString(),userId,event,details:String(details||'').slice(0,300)});db.audit=db.audit.slice(-1000);});}
}