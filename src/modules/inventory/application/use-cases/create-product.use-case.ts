import {Inject, Injectable} from "@nestjs/common";
import {IProductRepository, PRODUCT_REPOSITORY} from "@modules/inventory/domain/product.repository";
import {Product} from "@modules/inventory/domain/product.aggregate";
import {SupportedCurrency} from "@modules/inventory/domain/value-objects/money.vo";

export interface CreateProductCommand{
    name: string;
    description?: string;
    priceAmount: number;
    currency: SupportedCurrency;
    initialStock: number;
}

export interface CreateProductResult{
    productId: string;
}

@Injectable()
export class CreateProductUseCase {


    constructor( @Inject(PRODUCT_REPOSITORY)
                 private readonly productRepository: IProductRepository) { }

    async execute(command: CreateProductCommand): Promise<CreateProductResult> {
        const product = Product.create(command);
        await this.productRepository.save(product);
        return {
            productId: product.id.value
        }
    }
}