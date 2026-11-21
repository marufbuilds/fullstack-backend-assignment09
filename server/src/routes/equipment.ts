import {Router} from 'express';import Equipment from '../models/Equipment.js';
const router=Router();
router.get('/',async(req,res,next)=>{try{const {q,category,type,min,max,sort,availability}=req.query;const filter:any={status:'Approved'};if(category&&category!=='All')filter.category=category;if(type&&type!=='All')filter.rentalType=type;if(min||max)filter.price={$gte:Number(min||0),$lte:Number(max||Number.MAX_SAFE_INTEGER)};if(availability==='true')filter.quantity={$gt:0};if(q)filter.$or=[{name:{$regex:String(q),$options:'i'}},{location:{$regex:String(q),$options:'i'}},{category:{$regex:String(q),$options:'i'}}];const order=sort==='price-asc'?{price:1}:sort==='price-desc'?{price:-1}:{createdAt:-1};const docs=await Equipment.find(filter).sort(order).limit(100);res.json(docs);}catch(e){next(e)}});
router.get('/featured',async(_req,res,next)=>{try{res.json(await Equipment.find({status:'Approved'}).sort({createdAt:-1}).limit(6));}catch(e){next(e)}});
export default router;
