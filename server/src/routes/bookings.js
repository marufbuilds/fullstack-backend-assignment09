import {Router} from 'express';
import {ObjectId} from 'mongodb';
import {getDB} from '../db.js';
import {authenticate,allowRoles} from '../middleware/auth.js';
const router=Router();
router.use(authenticate);
router.post('/',allowRoles('customer'),async(req,res,next)=>{
 try{
  const {equipmentId,startDate,endDate}=req.body||{};
  if(!ObjectId.isValid(equipmentId)||!startDate||!endDate) return res.status(400).json({message:'Equipment and rental dates required'});
  const start=new Date(startDate),end=new Date(endDate);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start<=new Date()||end<=start) return res.status(400).json({message:'Choose valid future rental dates'});
  const db=getDB(),equipment=await db.collection('equipment').findOne({_id:new ObjectId(equipmentId),status:'approved'});
  if(!equipment) return res.status(404).json({message:'Equipment unavailable'});
  if(String(equipment.ownerId)===String(req.user._id)) return res.status(403).json({message:'You cannot rent your own equipment'});
  const conflict=await db.collection('bookings').findOne({equipmentId:equipment._id,startDate:{$lt:end},endDate:{$gt:start},$or:[{status:'confirmed'},{status:'pending',expiresAt:{$gt:new Date()}}]});
  if(conflict) return res.status(409).json({message:'Dates unavailable'});
  const days=Math.ceil((end-start)/(86400000)),amount=days*Number(equipment.price);
  if(!Number.isSafeInteger(days)||days<1||!Number.isFinite(amount)||amount<=0||amount>100000000) return res.status(400).json({message:'Rental duration or total price is invalid'});
  const booking={equipmentId:equipment._id,equipmentTitle:equipment.title,ownerId:equipment.ownerId,renterId:req.user._id,startDate:start,endDate:end,days,amount,status:'pending',paymentStatus:'unpaid',createdAt:new Date(),expiresAt:new Date(Date.now()+30*60*1000)};
  const result=await db.collection('bookings').insertOne(booking);
  res.status(201).json({...booking,_id:result.insertedId});
 }catch(e){next(e);}
});
router.get('/mine',async(req,res,next)=>{
 try{const items=await getDB().collection('bookings').find({renterId:req.user._id}).sort({createdAt:-1}).toArray();res.json(items);}catch(e){next(e);}
});
router.get('/owner',allowRoles('owner','admin'),async(req,res,next)=>{
 try{const items=await getDB().collection('bookings').find({ownerId:req.user._id}).sort({createdAt:-1}).toArray();res.json(items);}catch(e){next(e);}
});
router.patch('/:id/status',allowRoles('owner','admin'),async(req,res,next)=>{
 try{
  if(!ObjectId.isValid(req.params.id)) return res.status(400).json({message:'Invalid id'});
  const status=req.body?.status;if(!['confirmed','rejected','completed','cancelled'].includes(status))return res.status(400).json({message:'Invalid status'});
  const db=getDB(), booking=await db.collection('bookings').findOne({_id:new ObjectId(req.params.id)});
  if(!booking)return res.status(404).json({message:'Booking not found'});
  if(req.user.role!=='admin'&&String(booking.ownerId)!==String(req.user._id))return res.status(403).json({message:'Not allowed'});
  if(status==='confirmed'&&booking.paymentStatus!=='paid')return res.status(409).json({message:'Booking must be paid before confirmation'});
  await db.collection('bookings').updateOne({_id:booking._id},{$set:{status,updatedAt:new Date()}});
  res.json({message:'Booking updated'});
 }catch(e){next(e);}
});
export default router;
