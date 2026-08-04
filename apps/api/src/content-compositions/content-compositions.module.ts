import { Module } from '@nestjs/common';
import { ContentCompositionsController } from './content-compositions.controller';
import { ContentCompositionsService } from './content-compositions.service';

@Module({
  controllers: [ContentCompositionsController],
  providers: [ContentCompositionsService],
  exports: [ContentCompositionsService],
})
export class ContentCompositionsModule {}
