import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
// import { User } from 'src/users/schema/users.schema';
import {v4} from 'uuid'

@Schema(
    {
        timestamps: true
    }
)

export class Product extends Document{
    @Prop(
        {
          type: mongoose.Schema.Types.String,
          required: true
        }
      )
      code: string; 

    @Prop(
      { 
         type: mongoose.Schema.Types.ObjectId,
         ref: 'Category'
        }
    )
    category_id: Types.ObjectId;

    @Prop(
        {
            type: mongoose.Schema.Types.String,
            required: true,
        }
    )
    name: string;

    @Prop({
        type: mongoose.Schema.Types.String,
        required: true
    })
    detail: string;

    @Prop({
        type: mongoose.Schema.Types.String,
        required: true
    })
    specification: string;

    @Prop(
        {
            type: mongoose.Schema.Types.String,
            required: true
        }
    )
    standard: string;

    @Prop(
        {
            type: mongoose.Schema.Types.String,
            required: true
        }
    )
    unit: string;

    @Prop(
        {
            type: mongoose.Schema.Types.Number,
            required: true
        }
    )
    quantity: number;

    @Prop({ type: mongoose.Schema.Types.String, required: true })
    images: string;

    @Prop({type: mongoose.Schema.Types.String,required: false})
    note: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);