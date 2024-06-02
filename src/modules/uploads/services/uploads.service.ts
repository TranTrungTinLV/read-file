// ** Libraries
import * as sharp from "sharp";
import * as xlsx from "xlsx";
import { readEnv } from "read-env";
import * as _ from "lodash";
import { BadRequestException, Injectable, Logger, Scope } from "@nestjs/common";
import { existsSync, mkdirSync, rename, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";

// ** DI injections
import {
  Category,
  CategoryDocument,
} from "src/modules/category/schema/category.schema";
import { IImagePayload, IPImport } from "../interfaces/image-payload.interface";
import { genFlagRandom } from "src/common/utils/generator.helper";
import {
  filterDuplicates,
  filterImageFromCSV,
  getCellAddress,
  getColAddress,
  indexColsWorksheet,
} from "./filter_worksheet.service";
import { withTransaction } from "src/common/utils/withTransaction";
import { UploadCSVFileDto } from "../dtos/csv_upload.dto";
import { checkArrayAInArrayB } from "src/common/utils/checker.helper";
import { EDirUpload } from "src/common/enums/dir_upload.enum";
import { ConfigService } from "@nestjs/config";
import {
  Metadata,
  MetadataDocument,
} from "src/modules/metadata/schema/metadata.schema";
import { MongoServerError } from "mongodb";

@Injectable({ scope: Scope.REQUEST })
export class UploadsService {
  private static INDEX_START_ROW = 1;
  private static INDEX_TITLE_FILE_CSV = 0;
  private readonly logger = new Logger("UploadsService");

  constructor(
    // ** Models
    @InjectModel(Metadata.name)
    private locationModel: Model<Metadata>,
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>,
    @InjectModel(Metadata.name)
    private productModel: Model<Metadata>,

    //** Services
    private readonly configService: ConfigService,

    // ** Transactions
    @InjectConnection()
    private connection: Connection,
  ) {}

  /** Func mv file */
  moveFile(oldPath: string, newPath: string): void {
    rename(oldPath, newPath, function (err) {
      if (err) {
        this.logger.error(
          `Failed to move file from ${oldPath} to ${newPath}: ${err.message}`,
        );
      }
    });
  }

  /**
   * Func random character to generate prefix for image
   *
   * @param originalname
   * @returns
   */
  ranDomImagePath(originalname: string): string {
    const firstDashIndex = originalname.indexOf("-");
    const prefix = originalname.substring(0, firstDashIndex + 1);
    const randomSuffix = Math.round(Math.random() * 1e5);
    const replacedString =
      prefix + randomSuffix + originalname.substring(firstDashIndex + 6);
    return replacedString;
  }

  /**
   *  Func filter item unique
   *
   * @param urlImage
   * @returns
   */
  urlUniq(urlImage: string): string {
    const rootPathImageDir = resolve(
      __dirname,
      `../../../${readEnv("DIR_UPLOADS")[""]}/${readEnv("SUB_DIR_UPLOADS")[""]}/`,
    );
    return `/${_.toString(
      _.compact(_.uniq(`${rootPathImageDir}/${urlImage}`.split("/"))),
    ).replace(/,/gi, "/")}`;
  }

  private readonly rootPathImageDir = resolve(
    __dirname,
    `../../../../${process.env.DIR_UPLOADS}/${process.env.SUB_DIR_UPLOADS}/`,
  );

  /** Func remove file with argument is path of file in storage folder */
  removeFile(path: string): void {
    rmSync(`${this.urlUniq(path)}`, { force: true });
  }

  /** Func get path detail */
  withMediaPathOfSubject(payload: IImagePayload): string {
    const PathDesViaEnterpriseStrategies = new Map([
      [`${EDirUpload.PRODUCT}`, `${payload.dir}`],
      [`${EDirUpload.CATEGORY}`, `${payload.dir}`],
    ]);
    return PathDesViaEnterpriseStrategies.get(payload.dir);
  }

  /**
   * create folder to save image,
   * move files from images folder to folder created above
   */
  async createMediaFilesDir(payload: IImagePayload): Promise<string[]> {
    const path = this.withMediaPathOfSubject(payload);
    if (!existsSync(`${this.rootPathImageDir}/${path}`)) {
      mkdirSync(`${this.rootPathImageDir}/${path}`, { recursive: true });
    }
    const images: string[] = [];

    if (payload.image) {
      for (const i of payload.image) {
        let imageName: string;
        const oldPath = `${this.rootPathImageDir}/${i}`;
        const newPath = `${this.rootPathImageDir}/${path}/${i}`;

        this.moveFile(oldPath, newPath);
        this.removeFile(oldPath);

        // ** check not image format -> not resize
        const imagesFormat = ["png", "jpg", "png", "jpeg", "gif", "bmp"];
        const fileExtension = oldPath.split(".").pop()?.toLowerCase();

        if (fileExtension && imagesFormat.includes(fileExtension)) {
          // ** resize image
          imageName = await this.resizeImage(
            newPath,
            payload.width,
            payload.height,
          );
        } else {
          imageName = i;
        }
        images.push(
          `/${this.configService.get("SUB_DIR_UPLOADS")}/${path}/${imageName}`,
        );
      }
    }
    console.log(images);

    return images;
  }

  /** Func resize image  */
  async resizeImage(
    path: string,
    width: number,
    height: number,
  ): Promise<string> {
    try {
      const newName = this.ranDomImagePath(
        path.split("/")[path.split("/").length - 1],
      );

      // ** resize with sharp
      const newPath = path.substring(0, path.lastIndexOf("/") + 1) + newName;

      await sharp(path)
        .rotate()
        .resize(width, height, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        })
        .toFile(newPath);
      // ** remove file origin
      this.removeFile(path);
      return path.split("/")[path.split("/").length - 1];
    } catch (error) {
      this.logger.error(error);
    }
  }

  /** Func to write from Buffer */
  async writeFileSync(files: any[]) {
    const namesFile: string[] = [];
    for (const record of files) {
      const keyRandom = genFlagRandom(5);
      const pathFile = `${Date.now()}-${keyRandom}-${record.name}.${
        record.extension
      }`;
      await writeFileSync(
        `${this.rootPathImageDir}/${pathFile}`,
        <Buffer>record.buffer,
      );
      namesFile.push(`${pathFile}`);
    }
    return namesFile;
  }

  /**
   * Func gets all the fields needed to import an object - import file excel
   * @param modelName: collection name
   * @returns
   */
  listFieldSubject(modelName: string): string[] {
    const filedFilterSubjectDetail: Record<string, string[]> = {
      Metadata: [
        "code",
        "category_id",
        "name",
        "detail",
        "specification",
        "standard",
        "unit",
        "other_names",
        "images",
        "note",
      ],
    };
    return filedFilterSubjectDetail[modelName];
  }

  /** import files from csv,xlsx...vv */
  async importFile(req: any, body: UploadCSVFileDto, file) {
    const colsWorksheet: string[] = Object.values(JSON.parse(body.index));
    const keysWorksheet: string[] = Object.keys(JSON.parse(body.index));
    const workbook = xlsx.readFile(file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    const imagesFromCSV = await filterImageFromCSV(file);
    const fieldsOriginSubject = this.listFieldSubject(
      this.productModel.collection["modelName"],
    );
    const PImport: IPImport = {
      workbook,
      worksheet,
      range,
      fieldsOriginSubject,
      colsWorksheet,
      keysWorksheet,
      imagesFromCSV,
    };
    const data = xlsx.utils.sheet_to_json(worksheet);
    const filteredData = await filterDuplicates(data);
    await this.handleImportAsset(req, PImport);
  }

  /** Func handle filter list categories | locations -> after create documents */
  private async generateDocumentUniq(
    colName: string,
    payload: IPImport,
    session,
  ) {
    const namesCol: string[] = [],
      result = {};
    let newDocument: CategoryDocument;

    const indexColWorksheet = indexColsWorksheet(payload.range);
    const indexField = payload.fieldsOriginSubject.findIndex(
      (e) => e === colName,
    );
    const indexColDetail = indexColWorksheet[payload.colsWorksheet[indexField]];
    for (
      let row = payload.range.s.r + UploadsService.INDEX_START_ROW;
      row <= payload.range.e.r;
      row++
    ) {
      const cellAddress = getCellAddress(row, parseInt(indexColDetail));
      const cell = await payload.worksheet[cellAddress];
      if (cell?.v) {
        namesCol.push(cell?.v);
      }
    }
    const uniqueResult = Array.from(new Set(namesCol));
    for (const item of uniqueResult) {
      if (colName === "category_id") {
        newDocument = await this.categoryModel.findOne(
          { name: item },
          undefined,
          { session },
        );
        if (!newDocument) {
          [newDocument] = await this.categoryModel.create([{ name: item }], {
            session,
          });
        }
      }
      result[item] = newDocument._id;
    }
    return { result, indexField };
  }

  /** Func handle import asset data */
  private async handleImportAsset(req: any, payload: IPImport) {
    const BATCH_SIZE = 500; // Define batch size
    const rows = payload.range.e.r - payload.range.s.r;
    let currentRow = payload.range.s.r + UploadsService.INDEX_START_ROW;

    while (currentRow <= payload.range.e.r) {
      const batchEnd = Math.min(currentRow + BATCH_SIZE, payload.range.e.r + 1);
      try {
        await withTransaction(this.connection, async (session) => {
          const data = {},
            other_data = {};
          let imgsOfAsset: string[] = [];

          const rangeIndexColsWorksheet = indexColsWorksheet(payload.range);

          // ** create categories | locations
          const categories = await this.generateDocumentUniq(
            "category_id",
            payload,
            session,
          );

          let categoryId: Types.ObjectId = null;

          for (let row = currentRow; row <= batchEnd; row++) {
            for (let col = payload.range.s.c; col <= payload.range.e.c; col++) {
              const cellAddress = getCellAddress(
                row,
                rangeIndexColsWorksheet[payload.colsWorksheet[col]],
              );

              const cellContent = payload.worksheet[cellAddress];
              const colAddress = getColAddress(col);

              // ** image row
              if (payload.imagesFromCSV[cellAddress]) {
                imgsOfAsset = await this.writeFileSync(
                  payload.imagesFromCSV[cellAddress],
                );
              }

              // ** assign category
              if (categories.result[cellContent?.v]) {
                categoryId = categories.result[cellContent?.v];
              }

              // ** assign fields specific
              data[payload.fieldsOriginSubject[col]] = cellContent?.v;

              // ** other fields
              if (!payload.colsWorksheet.includes(colAddress)) {
                const titleCol = payload.worksheet[getCellAddress(0, col)];
                const cellAddress1 = getCellAddress(row, col);
                const cellContent = payload.worksheet[cellAddress1];
                other_data[titleCol?.v] = cellContent?.v;
              }
            }
            data["category_id"] = categoryId;
            data["other_fields"] = other_data;

            const fieldsRequire = [
              "code",
              "category_id",
              "name",
              "detail",
              "specification",
              "standard",
              "unit",
              "other_names",
              "images",
              "note",
            ];
            console.log("Data before converting undefined to null:", data);
            fieldsRequire.forEach((field) => {
              if (data[field] === undefined || data[field] === null) {
                data[field] = "default_value"; // hoặc giá trị mặc định nào đó phù hợp
              }
            });

            const missingColumns = fieldsRequire.filter(
              (col) => !payload.keysWorksheet.includes(col),
            );
            if (!checkArrayAInArrayB(fieldsRequire, payload.keysWorksheet)) {
              throw new BadRequestException(
                `Some columns are missing when doing import ${missingColumns}`,
              );
            }
            console.log("Data after processing row:", data);
            // ** check all fields require => can create asset
            const allFieldsHashValue = fieldsRequire.every(
              (field) => data[field] !== undefined && data[field] !== null,
            );

            // console.log(allFieldsHashValue)
            const assetExits = await this.productModel.findOne(
              { name: data["name"] },
              {},
              { session },
            );

            if ((!allFieldsHashValue || assetExits) && imgsOfAsset.length > 0) {
              imgsOfAsset.forEach((img) => {
                this.removeFile(img);
              });
            }

            if (!allFieldsHashValue) {
              fieldsRequire.forEach((field) => {
                if (data[field] === undefined) {
                  data[field] = null; // hoặc giá trị mặc định nào đó phù hợp
                }
              });
              this.logger.error(
                "Missing required fields:",
                fieldsRequire.filter((field) => !data[field]),
              );
            }

            if (assetExits) {
              this.logger.error("Asset already exists:", data["name"]);
            }

            if (allFieldsHashValue && !assetExits) {
              // ** images in row
              const PCreateAsset: any = {
                data,
                req,
                imgsOfAsset,
                session,
              };
              const asset = await this.createProduct(PCreateAsset);
              console.log(asset);
              this.logger.debug(
                `Process - Import asset: create new asset ${asset.name}`,
              );
            }
          }
        });
      } catch (error) {
        if (error instanceof MongoServerError) {
          this.logger.error(`Transaction failed: ${error.message}`);
          // Có thể thêm logic thử lại giao dịch ở đây nếu cần thiết
        } else {
          throw error;
        }
      }
      currentRow = batchEnd;
    }
  }

  async createProduct(payload): Promise<Metadata> {
    const { data, req, session } = payload;
    this.logger.debug(
      `Data received for creating product: ${JSON.stringify(data)}`,
    );
    console.log(`Data received for creating product: ${JSON.stringify(data)}`);
    console.log(data);
    let imgsOfAsset: string[] = payload.imgsOfAsset;
    this.logger.debug(
      `Images of asset before processing: ${JSON.stringify(imgsOfAsset)}`,
    );

    console.log(data);
    let asset;
    try {
      [asset] = await this.productModel.create([data], {
        session,
      });

      this.logger.debug(`Product created with data: ${JSON.stringify(asset)}`);
    } catch (error) {
      this.logger.error(
        `Error creating product: ${error.message}`,
        error.stack,
      );
      throw error;
    }

    // ** create dir upload file for this asset
    if (imgsOfAsset.length > 0) {
      const payloadMediaDir: IImagePayload = {
        idUser: req.user._id,
        idAsset: asset._id,
        dir: EDirUpload.PRODUCT,
        image: imgsOfAsset,
        width: 800,
        height: 800,
      };
      try {
        imgsOfAsset = await this.createMediaFilesDir(payloadMediaDir);
        this.logger.debug(
          `Images processed and directories created: ${JSON.stringify(imgsOfAsset)}`,
        );
      } catch (error) {
        this.logger.error(
          `Error processing images: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    }

    // ** update QRCode
    try {
      await asset.updateOne({ images: imgsOfAsset }, { session });
      this.logger.debug(
        `Product updated with images: ${JSON.stringify(imgsOfAsset)}`,
      );
    } catch (error) {
      this.logger.error(
        `Error updating product with images: ${error.message}`,
        error.stack,
      );
      throw error;
    }
    return asset;
  }
}
