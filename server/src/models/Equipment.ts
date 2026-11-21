import mongoose,{Schema} from 'mongoose';
const schema=new Schema({name:{type:String,required:true,index:true},description:String,category:{type:String,required:true,index:true},location:{type:String,required:true,index:true},price:{type:Number,required:true,min:0},rentalType:{type:String,enum:['Daily','Weekly','Monthly'],default:'Daily'},quantity:{type:Number,required:true,min:0},condition:String,brand:String,model:String,image:String,terms:String,ownerId:{type:String,required:true,index:true},ownerName:String,status:{type:String,enum:['Pending','Approved','Rejected'],default:'Pending',index:true}},{timestamps:true});
schema.index({name:'text',category:'text',location:'text'});
export default mongoose.models.Equipment||mongoose.model('Equipment',schema);
