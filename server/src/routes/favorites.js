import {Router} from 'express';
import {ObjectId} from 'mongodb';
import {getDB} from '../db.js';
import {authenticate} from '../middleware/auth.js';
const router=Router();router.use(authenticate);
router.get('/',async(req,res,next)=>{try{const rows=await getDB().collection('favorites').find({userId:req.user._id}).toArray();res.json(rows);}catch(e){next(e);}});
router.post('/:equipmentId',async(req,res,next)=>{try{
 if(!ObjectId.isValid(req.params.equipmentId))return res.status(400).json({message:'Invalid id'});
 const id=new ObjectId(req.params.equipmentId), db=getDB();
 if(!await db.collection('equipment').findOne({_id:id,status:'approved'}))return res.status(404).json({message:'Equipment not found'});
 await db.collection('favorites').updateOne({userId:req.user._id,equipmentId:id},{$setOnInsert:{userId:req.user._id,equipmentId:id,createdAt:new Date()}},{upsert:true});
 res.json({message:'Saved'});
}catch(e){next(e);}});
router.delete('/:equipmentId',async(req,res,next)=>{try{
 if(!ObjectId.isValid(req.params.equipmentId))return res.status(400).json({message:'Invalid id'});
 await getDB().collection('favorites').deleteOne({userId:req.user._id,equipmentId:new ObjectId(req.params.equipmentId)});res.json({message:'Removed'});
}catch(e){next(e);}});
export default router;
