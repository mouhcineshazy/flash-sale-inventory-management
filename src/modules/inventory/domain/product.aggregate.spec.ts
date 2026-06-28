import {Product} from "@modules/inventory/domain/product.aggregate";

describe('Product Aggregate', () => {

    describe('reserveStock()', () =>{
        let product: Product;
        beforeEach(() => {
            product = Product.create({name:'product1', priceAmount: 200, currency:'USD', initialStock: 2});
        })
        it('should be able to reserve stock',()=>{
            //Act
            product.reserveStock();
            //expect
            expect(product.stock.value).toBe(1);
        })

        it('should throw error when stock is zero',()=>{
            const productZero = Product.create({name:'product1', priceAmount: 200, currency:'USD', initialStock: 0});

            expect(() => productZero.reserveStock()).toThrow(`Product "${productZero.name}" is out of stock`);

        });

    });
    describe('create()', () => {
        it('should be able to create product', ()=>{
            const product = Product.create({name: 'product1', priceAmount: 200, currency: 'USD', initialStock: 2});
            expect(product.name).toBe('product1');
            expect(product.stock.value).toBe(2);        })
        it('should throw error when name is not provided',()=>{
            expect(() => Product.create({name:'', priceAmount: 200, currency:'USD', initialStock: 2})).toThrow('Product name cannot be empty');
        })
        it('should throw error when stock is negative',()=>{
            expect(() => Product.create({name:'Product 2', priceAmount: 200, currency:'USD', initialStock: -1})).toThrow('StockCount cannot be negative, received: -1');

        })
        it('should throw error when price is negative',()=>{
            expect(() => Product.create({name:'Product 2', priceAmount: -200, currency:'USD', initialStock: -1})).toThrow('Money amount cannot be negative');

        })
    })

    describe('releaseStock()', () =>{
        it('should increment stock when stock is released',()=>{
            const product = Product.create({name:'product1', priceAmount: 200, currency:'USD', initialStock: 2});
            product.reserveStock();

            product.releaseStock();

            expect(product.stock.value).toBe(2);
        })
    })
})