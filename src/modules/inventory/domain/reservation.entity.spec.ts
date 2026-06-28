import {Reservation, ReservationStatus} from "@modules/inventory/domain/reservation.entity";
import {ProductId} from "@modules/inventory/domain/value-objects/product-id.vo";

describe("Reservation Entity test",() => {
    describe('confirm()', ()=> {
        let reservation: Reservation;
        beforeEach(() => {
            //Arrange
            reservation = Reservation.create(ProductId.generate(), 'user-1');


        });
        it("should confirm a reservation", () => {
            // Act
            reservation.confirm();
            //Assert
            expect(reservation.status).toBe(ReservationStatus.CONFIRMED);
        });
        it('should throw an error if Status is not Pending',() => {
            // Act
            reservation.confirm();
            //Expect
            expect(()=> reservation.confirm()).toThrow('Cannot confirm a reservation in status: CONFIRMED');
        });
        it('should throw an error if reservation is expired',() => {
            const expiredReservation = Reservation.reconstitute({
                id: 'some-uuid',
                productId: 'some-product-id',
                userId: 'user-1',
                status: ReservationStatus.PENDING,
                expiresAt: new Date(Date.now() - 1000), // 1 second in the past
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            expect(()=> expiredReservation.confirm()).toThrow('Cannot confirm an expired reservation');
        });
    });
    describe('release()', () =>{
        let reservation: Reservation;
        beforeEach(()=>{
            reservation = Reservation.create(ProductId.generate(), 'user-1');
        })
        it('should release a reservation successfully',()=>{
            //Act
            reservation.release();
            //Expect
            expect(reservation.status).toBe(ReservationStatus.RELEASED);
        });
        it('should throw an error when reservation status is CONFIRMED',()=>{
            //Act
            reservation.confirm();
            //Expect
            expect(()=> reservation.release()).toThrow('Cannot release a confirmed reservation');

        })
    })

    describe('isExpired()', () =>{
        it('should return true if reservation is expired',()=>{
            const expiredReservation = Reservation.reconstitute({
                id: 'some-uuid',
                productId: 'some-product-id',
                userId: 'user-1',
                status: ReservationStatus.PENDING,
                expiresAt: new Date(Date.now() - 1000), // 1 second in the past
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            expect(expiredReservation.isExpired()).toBe(true);
        });
        it('should return false if reservation is not expired',()=>{
            const reservation = Reservation.create(ProductId.generate(), 'user-1');
            expect(reservation.isExpired()).toBe(false);
        })

    })

})